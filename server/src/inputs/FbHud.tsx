import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  InputStream,
  Rescaler,
  Text,
  View,
  useInputStreams,
} from '@swmansion/smelter';
import type { Api } from '@swmansion/smelter';

type TextWeight = Api.TextWeight;
import type { FbHudState } from '../app/store';
import { KBT_VIEW_TRANSITION_MS, fbMinimapRect } from '../app/store';
import { TransitionShaderWrapper } from './transitionWrapper';
import {
  MINIMAP_PITCH,
  MINIMAP_PLATE,
  clockFace,
  formatClock,
  minimapLines,
  minimapPoint,
  minimapScale,
  monoWidth,
  tagChipRect,
} from './fbHudMetrics';

/**
 * Football game ("Touchline") broadcast chrome. Night-navy plates with one
 * cut corner, chalk text, a grass accent, amber for the referee's calls; team
 * colours painted at runtime as stripes, never under text. Static art comes
 * from scripts/fb-render-assets.mjs (imgs/fb/*.png registered as
 * `fb-<name>`); this file composites the dynamic values on top at the
 * design's 1080p pixel positions scaled by resolution.height/1080.
 *
 * `stage` follows the layout at once (scene, replay window); everything else
 * was held by the clip's side-channel delay (0 for plain file cams).
 */

const DISPLAY = 'Big Shoulders Display';
const MONO = 'IBM Plex Mono';
const CHALK = '#F4F1E8';
const CHALK_85 = '#F4F1E8D9';
const DIM = '#F4F1E8B3';
const DIM2 = '#F4F1E880';
const NAVY = '#0B1220';
const GRASS = '#2FBF71';
const GOLD = '#E8B33A';
const GOOD = '#2FBF71';
const AMBER = '#FFB020';
const BAD = '#FF3B3B';
const BLACK: TextWeight = 'black';

type Resolution = { width: number; height: number };

function Art({
  id,
  x,
  y,
  w,
  h,
  k,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
}) {
  const width = Math.round(w * k);
  const height = Math.round(h * k);
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width,
        height,
        overflow: 'hidden',
      }}>
      <Rescaler style={{ width, height, rescaleMode: 'fit' }}>
        <Image imageId={id} />
      </Rescaler>
    </View>
  );
}

function Block({
  x,
  y,
  w,
  h,
  k,
  color,
  radius,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  color: string;
  radius?: number;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.max(1, Math.round(w * k)),
        height: Math.max(1, Math.round(h * k)),
        backgroundColor: color,
        ...(radius ? { borderRadius: Math.round(radius * k) } : {}),
      }}
    />
  );
}

function Group({
  x,
  y,
  w,
  h,
  k,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.round(w * k),
        height: Math.round(h * k),
        overflow: 'visible',
      }}>
      {children}
    </View>
  );
}

const CAP_CENTER: Record<string, number> = { [DISPLAY]: 0.585, [MONO]: 0.68 };

function Label({
  x,
  y = 0,
  w,
  text,
  fs,
  k,
  color = CHALK,
  font = DISPLAY,
  weight = 'extra_bold',
  align = 'left',
  centerIn,
}: {
  x: number;
  y?: number;
  w: number;
  text: string;
  fs: number;
  k: number;
  color?: string;
  font?: string;
  weight?: TextWeight;
  align?: 'left' | 'center' | 'right';
  centerIn?: number;
}) {
  const width = Math.round(w * k);
  const top =
    centerIn != null ? y + centerIn / 2 - (CAP_CENTER[font] ?? 0.585) * fs : y;
  return (
    <View
      style={{
        top: Math.round(top * k),
        left: Math.round(x * k),
        width,
        height: Math.round(fs * 1.45 * k),
        overflow: 'hidden',
      }}>
      <Text
        style={{
          fontSize: Math.round(fs * k),
          color,
          width,
          align,
          fontFamily: font,
          fontWeight: weight,
        }}>
        {text}
      </Text>
    </View>
  );
}

function TagChip({
  text,
  cx,
  y,
  k,
  tone,
}: {
  text: string;
  cx: number;
  y: number;
  k: number;
  tone: 'grass' | 'amber' | 'chalk' | 'outline';
}) {
  const r = tagChipRect(text, 11, cx, y, 16);
  if (tone === 'outline') {
    return (
      <>
        <Art id='fb-tag-outline' x={r.x} y={r.y} w={r.w} h={r.h} k={k} />
        <Label
          x={r.x}
          y={r.y}
          w={r.w}
          text={text}
          fs={11}
          k={k}
          font={MONO}
          weight='semi_bold'
          align='center'
          color={DIM}
          centerIn={r.h}
        />
      </>
    );
  }
  const bg = tone === 'grass' ? GRASS : tone === 'amber' ? AMBER : CHALK;
  return (
    <>
      <Block x={r.x} y={r.y} w={r.w} h={r.h} k={k} color={bg} />
      <Label
        x={r.x}
        y={r.y}
        w={r.w}
        text={text}
        fs={11}
        k={k}
        font={MONO}
        weight='semi_bold'
        align='center'
        color={NAVY}
        centerIn={r.h}
      />
    </>
  );
}

// ── Live chrome ──────────────────────────────────────────────────────────────

const CLOCK_COLOR = {
  chalk: CHALK,
  amber: AMBER,
  bad: BAD,
  grass: GRASS,
  dim: DIM,
} as const;

/** Score bug (70,40) 820×92: stripes + names + scores around the clock cell. */
function ScoreBug({ hud, k }: { hud: FbHudState; k: number }) {
  const face = clockFace(hud.clock);
  const a = hud.teams.A;
  const b = hud.teams.B;
  const scoring =
    hud.lastEvent?.showBanner &&
    hud.lastEvent.kind === 'goal' &&
    !hud.lastEvent.pending
      ? hud.lastEvent.team
      : null;
  const mainFs = face.main.length > 6 ? 22 : 30;
  return (
    <Group x={70} y={40} w={820} h={92} k={k}>
      <Art id='fb-scorebug-plate' x={0} y={0} w={820} h={92} k={k} />
      <Block x={0} y={0} w={16} h={92} k={k} color={a.color} />
      <Block x={804} y={18} w={16} h={74} k={k} color={b.color} />
      <Label
        x={38}
        y={26}
        w={250}
        text={a.name.toUpperCase()}
        fs={34}
        k={k}
        centerIn={40}
      />
      <Label
        x={288}
        y={16}
        w={96}
        text={String(a.score)}
        fs={58}
        k={k}
        align='center'
        centerIn={60}
        color={scoring === 'A' ? GRASS : CHALK}
      />
      <Label
        x={384}
        y={20}
        w={150}
        text={face.main}
        fs={mainFs}
        k={k}
        font={MONO}
        weight='semi_bold'
        align='center'
        centerIn={32}
        color={CLOCK_COLOR[face.mainColor]}
      />
      <TagChip text={face.tag} cx={459} y={58} k={k} tone={face.tagTone} />
      <Label
        x={554}
        y={16}
        w={96}
        text={String(b.score)}
        fs={58}
        k={k}
        align='center'
        centerIn={60}
        color={scoring === 'B' ? GRASS : CHALK}
      />
      <Label
        x={532}
        y={26}
        w={250}
        text={b.name.toUpperCase()}
        fs={34}
        k={k}
        align='right'
        centerIn={40}
      />
    </Group>
  );
}

/** Goal candidates waiting for the moderator ("AWAITING REF · n"). */
function PendingPill({ hud, k }: { hud: FbHudState; k: number }) {
  if (hud.pendingCount <= 0) return null;
  return (
    <Group x={70} y={150} w={270} h={54} k={k}>
      <Art id='fb-pending-pill' x={0} y={0} w={270} h={54} k={k} />
      <Label
        x={214}
        y={12}
        w={40}
        text={String(hud.pendingCount)}
        fs={30}
        k={k}
        align='right'
        centerIn={32}
        color={AMBER}
      />
    </Group>
  );
}

/** Event card over the live picture (CHANCE / SHOT / CORNER / GOAL?). */
function EventBanner({ hud, k }: { hud: FbHudState; k: number }) {
  const e = hud.lastEvent;
  if (!e || !e.showBanner) return null;
  const goal = e.kind === 'goal';
  const title = goal ? (e.pending ? 'GOAL?' : 'GOAL!') : e.title;
  return (
    <Group x={460} y={320} w={1000} h={290} k={k}>
      <Art id='fb-banner-event' x={0} y={0} w={1000} h={290} k={k} />
      <Block
        x={0}
        y={0}
        w={16}
        h={290}
        k={k}
        color={e.pending ? AMBER : e.color}
      />
      <Label
        x={60}
        y={70}
        w={880}
        text={title}
        fs={goal ? 120 : 96}
        k={k}
        weight={BLACK}
        color={goal && !e.pending ? GRASS : e.pending ? AMBER : CHALK}
        centerIn={130}
      />
      <Label
        x={60}
        y={214}
        w={880}
        text={
          e.pending
            ? 'REF CALL · AWAITING THE MODERATOR'
            : `${(e.teamName ?? '').toUpperCase()}${e.detail ? ` · ${e.detail.toUpperCase()}` : ''}`
        }
        fs={40}
        k={k}
        color={e.pending ? AMBER : CHALK}
        centerIn={60}
      />
    </Group>
  );
}

const REPLAY_PLATE = { x: 312, y: 162, w: 1296, h: 764 };
const REPLAY_CLIP = { x: 320, y: 204, w: 1280, h: 720 };

/** Instant replay window over the dimmed live layout. */
function ReplayWindow({
  hud,
  k,
  resolution,
}: {
  hud: FbHudState;
  k: number;
  resolution: Resolution;
}) {
  const replay = hud.stage.replay;
  const streams = useInputStreams();
  if (!replay) return null;
  const playing = streams[replay.inputId]?.videoState === 'playing';
  const clipW = Math.round(REPLAY_CLIP.w * k);
  const clipH = Math.round(REPLAY_CLIP.h * k);
  return (
    <>
      <View
        style={{
          top: 0,
          left: 0,
          width: resolution.width,
          height: resolution.height,
          backgroundColor: '#0B1220B3',
        }}
      />
      <Block
        x={REPLAY_CLIP.x}
        y={REPLAY_CLIP.y}
        w={REPLAY_CLIP.w}
        h={REPLAY_CLIP.h}
        k={k}
        color='#070B14'
      />
      {playing ? (
        <View
          style={{
            top: Math.round(REPLAY_CLIP.y * k),
            left: Math.round(REPLAY_CLIP.x * k),
            width: clipW,
            height: clipH,
            overflow: 'hidden',
          }}>
          <Rescaler
            style={{ width: clipW, height: clipH, rescaleMode: 'fill' }}>
            <InputStream inputId={replay.inputId} />
          </Rescaler>
        </View>
      ) : null}
      <Art
        id='fb-replay-frame'
        x={REPLAY_PLATE.x}
        y={REPLAY_PLATE.y}
        w={REPLAY_PLATE.w}
        h={REPLAY_PLATE.h}
        k={k}
      />
      <Block
        x={REPLAY_CLIP.x}
        y={REPLAY_CLIP.y}
        w={16}
        h={REPLAY_CLIP.h}
        k={k}
        color={replay.color}
      />
      <Group
        x={REPLAY_PLATE.x}
        y={REPLAY_PLATE.y}
        w={REPLAY_PLATE.w}
        h={42}
        k={k}>
        <Label
          x={760}
          y={8}
          w={520}
          text={`${replay.title} · ${(replay.teamName ?? '').toUpperCase()} · ${replay.clock}`}
          fs={24}
          k={k}
          align='right'
          color={CHALK}
          centerIn={26}
        />
      </Group>
    </>
  );
}

/** Kick-off / half time / lead change / final banner (bottom centre). */
function Banner({ hud, k }: { hud: FbHudState; k: number }) {
  const banner = hud.banner;
  if (!banner) return null;
  const draw = banner.kind === 'final' && banner.text.includes('DRAW');
  const textColor =
    banner.kind === 'final' && !draw
      ? GOLD
      : banner.kind === 'kick_off'
        ? GRASS
        : CHALK;
  const weight: TextWeight = banner.kind === 'kick_off' ? BLACK : 'bold';
  return (
    <Group x={510} y={880} w={900} h={84} k={k}>
      <Art id='fb-banner-plate' x={0} y={0} w={900} h={84} k={k} />
      {draw ? (
        <>
          <Block x={0} y={80} w={450} h={4} k={k} color={hud.teams.A.color} />
          <Block x={450} y={80} w={450} h={4} k={k} color={hud.teams.B.color} />
        </>
      ) : (
        <Block x={0} y={80} w={900} h={4} k={k} color={banner.color} />
      )}
      <Label
        x={40}
        y={16}
        w={820}
        text={banner.text.toUpperCase()}
        fs={44}
        k={k}
        weight={weight}
        align='center'
        centerIn={48}
        color={textColor}
      />
    </Group>
  );
}

// ── Minimap ──────────────────────────────────────────────────────────────────

/** Rim under every player dot, so a dark kit still reads on the dark pitch. */
const DOT_RIM = '#F4F1E899';

/** Tracking minimap (bottom-left): pitch outline, both sides' players, ball, sprint chip. */
function MinimapPlate({
  hud,
  k,
  resolution,
}: {
  hud: FbHudState;
  k: number;
  resolution: Resolution;
}) {
  const m = hud.minimap;
  if (!m) return null;
  const rect = fbMinimapRect(resolution, m.size);
  // The whole plate scales as one: every child is drawn at the plate's own k.
  const pk = k * minimapScale(m.size);
  const ox = rect.x / pk;
  const oy = rect.y / pk;
  const dot = 9;
  return (
    <Group x={ox} y={oy} w={MINIMAP_PLATE.w} h={MINIMAP_PLATE.h} k={pk}>
      <Block
        x={0}
        y={0}
        w={MINIMAP_PLATE.w}
        h={MINIMAP_PLATE.h}
        k={pk}
        color='#0B1220E6'
      />
      <Block x={0} y={0} w={MINIMAP_PLATE.w} h={3} k={pk} color={GRASS} />
      {m.away.length > 0 ? (
        // Two sides on the plate: the header doubles as the colour legend.
        [
          { x: 14, color: m.teamColor, text: m.teamShort },
          { x: 76, color: m.awayColor, text: m.awayShort },
        ].map((side) => (
          <React.Fragment key={side.x}>
            <Block
              x={side.x - 1}
              y={9}
              w={dot + 2}
              h={dot + 2}
              k={pk}
              color={DOT_RIM}
              radius={(dot + 2) / 2}
            />
            <Block
              x={side.x}
              y={10}
              w={dot}
              h={dot}
              k={pk}
              color={side.color}
              radius={dot / 2}
            />
            <Label
              x={side.x + dot + 5}
              y={6}
              w={46}
              text={side.text}
              fs={11}
              k={pk}
              font={MONO}
              weight='semi_bold'
              color={DIM}
              centerIn={16}
            />
          </React.Fragment>
        ))
      ) : (
        <Label
          x={14}
          y={6}
          w={200}
          text={`TRACKING · ${m.teamShort}`}
          fs={11}
          k={pk}
          font={MONO}
          weight='semi_bold'
          color={DIM}
          centerIn={16}
        />
      )}
      {m.top ? (
        <Label
          x={160}
          y={6}
          w={162}
          text={`TOP #${m.top.tag} ${m.top.kmh} KM/H`}
          fs={11}
          k={pk}
          font={MONO}
          weight='semi_bold'
          align='right'
          color={DIM2}
          centerIn={16}
        />
      ) : null}
      <Block
        x={MINIMAP_PITCH.x}
        y={MINIMAP_PITCH.y}
        w={MINIMAP_PITCH.w}
        h={MINIMAP_PITCH.h}
        k={pk}
        color='#173B2A'
      />
      {minimapLines().map((l, i) => (
        <Block
          key={i}
          x={l.x}
          y={l.y}
          w={l.w}
          h={l.h}
          k={pk}
          color='#F4F1E866'
        />
      ))}
      {m.away.map((p, i) => {
        const pt = minimapPoint(p.x, p.y);
        return (
          <React.Fragment key={`away-${i}`}>
            <Block
              x={pt.x - dot / 2 - 1}
              y={pt.y - dot / 2 - 1}
              w={dot + 2}
              h={dot + 2}
              k={pk}
              color={DOT_RIM}
              radius={(dot + 2) / 2}
            />
            <Block
              x={pt.x - dot / 2}
              y={pt.y - dot / 2}
              w={dot}
              h={dot}
              k={pk}
              color={m.awayColor}
              radius={dot / 2}
            />
          </React.Fragment>
        );
      })}
      {m.players.map((p) => {
        const pt = minimapPoint(p.x, p.y);
        const sprinting = m.sprint?.tag === p.tag;
        return (
          <React.Fragment key={p.tag}>
            <Block
              x={pt.x - dot / 2 - 1}
              y={pt.y - dot / 2 - 1}
              w={dot + 2}
              h={dot + 2}
              k={pk}
              color={DOT_RIM}
              radius={(dot + 2) / 2}
            />
            <Block
              x={pt.x - dot / 2}
              y={pt.y - dot / 2}
              w={dot}
              h={dot}
              k={pk}
              color={sprinting ? AMBER : m.teamColor}
              radius={dot / 2}
            />
            <Label
              x={pt.x - 12}
              y={pt.y - 20}
              w={24}
              text={String(p.tag)}
              fs={9}
              k={pk}
              font={MONO}
              weight='semi_bold'
              align='center'
              color={sprinting ? AMBER : CHALK_85}
              centerIn={12}
            />
          </React.Fragment>
        );
      })}
      {m.ball
        ? (() => {
            const pt = minimapPoint(m.ball.x, m.ball.y);
            return (
              <Block
                x={pt.x - 4}
                y={pt.y - 4}
                w={8}
                h={8}
                k={pk}
                color={CHALK}
                radius={4}
              />
            );
          })()
        : null}
      {m.sprint ? (
        <>
          <Block
            x={14}
            y={MINIMAP_PLATE.h - 14 - 18}
            w={140}
            h={18}
            k={pk}
            color={AMBER}
          />
          <Label
            x={14}
            y={MINIMAP_PLATE.h - 14 - 18}
            w={140}
            text={`SPRINT #${m.sprint.tag} · ${m.sprint.kmh} KM/H`}
            fs={10}
            k={pk}
            font={MONO}
            weight='semi_bold'
            align='center'
            color={NAVY}
            centerIn={18}
          />
        </>
      ) : null}
    </Group>
  );
}

// ── Lobby / ended ────────────────────────────────────────────────────────────

function LobbyScene({ hud, k }: { hud: FbHudState; k: number }) {
  const lobby = hud.lobby;
  if (!lobby) return null;
  const cams = lobby.cams;
  const tel = lobby.telemetry;
  return (
    <>
      <Art id='fb-lobby-scrim' x={0} y={0} w={1920} h={1080} k={k} />
      <Art id='fb-lobby-title' x={70} y={60} w={760} h={150} k={k} />
      <Art id='fb-lobby-tag' x={1150} y={40} w={700} h={220} k={k} />
      <Group x={370} y={620} w={1180} h={400} k={k}>
        <Art id='fb-lobby-panel' x={0} y={0} w={1180} h={400} k={k} />
        {lobby.qr.imageId ? (
          <Art id={lobby.qr.imageId} x={32} y={84} w={150} h={150} k={k} />
        ) : null}
        <Label
          x={202}
          y={120}
          w={220}
          text={
            lobby.commentatorName ? '● MODERATOR IN' : '○ SCAN FOR THE PANEL'
          }
          fs={11}
          k={k}
          font={MONO}
          weight='semi_bold'
          color={lobby.commentatorName ? GOOD : DIM}
          centerIn={16}
        />
        <Label
          x={202}
          y={146}
          w={220}
          text={lobby.commentatorName ?? ''}
          fs={22}
          k={k}
          font={MONO}
          weight='medium'
          centerIn={28}
        />
        {lobby.qr.label ? (
          <Label
            x={202}
            y={248}
            w={220}
            text={lobby.qr.label}
            fs={11}
            k={k}
            font={MONO}
            weight='normal'
            color={DIM2}
            centerIn={14}
          />
        ) : null}
        <Label
          x={480}
          y={84}
          w={660}
          text='CAMERAS'
          fs={11}
          k={k}
          font={MONO}
          weight='semi_bold'
          color={DIM}
          centerIn={16}
        />
        {cams.length === 0 ? (
          <Label
            x={480}
            y={112}
            w={660}
            text='○ ATTACH A CLIP FROM THE HOST'
            fs={14}
            k={k}
            font={MONO}
            weight='medium'
            color={AMBER}
            centerIn={20}
          />
        ) : (
          cams.map((c, i) => (
            <React.Fragment key={c.role}>
              <Label
                x={480}
                y={112 + i * 30}
                w={140}
                text={c.role.toUpperCase()}
                fs={16}
                k={k}
                font={MONO}
                weight='semi_bold'
                color={c.live ? GOOD : AMBER}
                centerIn={22}
              />
              <Label
                x={620}
                y={112 + i * 30}
                w={520}
                text={(c.fileName ?? '').split('/').slice(-2).join('/')}
                fs={14}
                k={k}
                font={MONO}
                weight='medium'
                color={CHALK_85}
                centerIn={22}
              />
            </React.Fragment>
          ))
        )}
        {tel ? (
          <Label
            x={480}
            y={250}
            w={660}
            text={`TELEMETRY · ${[tel.ball ? 'BALL' : null, tel.zxy ? 'PLAYERS' : null, tel.events ? 'EVENTS' : null].filter(Boolean).join(' · ') || 'NONE'}`}
            fs={11}
            k={k}
            font={MONO}
            weight='semi_bold'
            color={tel.ball || tel.zxy ? GOOD : DIM}
            centerIn={16}
          />
        ) : null}
        <Block x={32} y={344} w={12} h={22} k={k} color={hud.teams.A.color} />
        <Label
          x={56}
          y={340}
          w={300}
          text={hud.teams.A.name.toUpperCase()}
          fs={28}
          k={k}
          centerIn={32}
        />
        <Block x={440} y={344} w={12} h={22} k={k} color={hud.teams.B.color} />
        <Label
          x={464}
          y={340}
          w={300}
          text={hud.teams.B.name.toUpperCase()}
          fs={28}
          k={k}
          centerIn={32}
        />
        <Label
          x={700}
          y={348}
          w={440}
          text={`2 × ${Math.round(lobby.halfMs / 60000)} MIN`}
          fs={14}
          k={k}
          font={MONO}
          weight='normal'
          align='right'
          color={DIM}
          centerIn={16}
        />
      </Group>
    </>
  );
}

function EndedScene({ hud, k }: { hud: FbHudState; k: number }) {
  const ended = hud.ended;
  if (!ended) return null;
  const winnerName = ended.winner
    ? hud.teams[ended.winner].name.toUpperCase()
    : null;
  const headline = winnerName ? `${winnerName} WIN` : 'FULL TIME — DRAW';
  const rest = ended.topSpeed
    ? ` · TOP SPEED #${ended.topSpeed.tag} ${ended.topSpeed.kmh} KM/H`
    : '';
  const headW = monoWidth(headline, 14);
  const cellLabels = ['CHANCES', 'SHOTS', 'ON TARGET', 'CORNERS'];
  return (
    <>
      <Block x={0} y={0} w={1920} h={1080} k={k} color='#0B1220D1' />
      <Group x={360} y={180} w={1200} h={720} k={k}>
        <Art id='fb-ended-panel' x={0} y={0} w={1200} h={720} k={k} />
        {(['A', 'B'] as const).map((team, i) => {
          const right = i === 1;
          const t = hud.teams[team];
          const s = ended.teams[team];
          const win = ended.winner === team;
          const cells = [
            String(s.chances),
            String(s.shots),
            String(s.shotsOnTarget),
            String(s.corners),
          ];
          const nameW = Math.min(380, t.name.length * 0.5 * 40 + 20);
          return (
            <React.Fragment key={team}>
              <Block
                x={right ? 1140 : 44}
                y={150}
                w={16}
                h={470}
                k={k}
                color={t.color}
              />
              <Label
                x={right ? 1114 - 380 : 86}
                y={150}
                w={380}
                text={t.name.toUpperCase()}
                fs={40}
                k={k}
                align={right ? 'right' : 'left'}
                centerIn={44}
              />
              {win ? (
                <Art
                  id='fb-winner-tag'
                  x={right ? 1114 - nameW - 16 - 110 : 86 + nameW + 16}
                  y={160}
                  w={110}
                  h={24}
                  k={k}
                />
              ) : null}
              <Label
                x={right ? 1114 - 480 : 86}
                y={204}
                w={480}
                text={String(s.score)}
                fs={190}
                k={k}
                weight={BLACK}
                align={right ? 'right' : 'left'}
                color={win ? GOLD : ended.winner ? CHALK_85 : CHALK}
                centerIn={180}
              />
              {cells.map((value, c) => (
                <React.Fragment key={c}>
                  <Label
                    x={right ? 1114 - 110 - c * 120 : 86 + c * 120}
                    y={560}
                    w={110}
                    text={cellLabels[c]}
                    fs={10}
                    k={k}
                    font={MONO}
                    weight='semi_bold'
                    align={right ? 'right' : 'left'}
                    color={DIM2}
                    centerIn={14}
                  />
                  <Label
                    x={right ? 1114 - 110 - c * 120 : 86 + c * 120}
                    y={586}
                    w={110}
                    text={value}
                    fs={36}
                    k={k}
                    align={right ? 'right' : 'left'}
                    centerIn={40}
                  />
                </React.Fragment>
              ))}
            </React.Fragment>
          );
        })}
        <Label
          x={44}
          y={662}
          w={headW + 20}
          text={headline}
          fs={14}
          k={k}
          font={MONO}
          weight='normal'
          color={winnerName ? GOLD : CHALK}
          centerIn={20}
        />
        <Label
          x={44 + headW}
          y={662}
          w={1112 - headW}
          text={rest}
          fs={14}
          k={k}
          font={MONO}
          weight='normal'
          color={DIM}
          centerIn={20}
        />
        <Label
          x={700}
          y={662}
          w={456}
          text={
            ended.topDistance
              ? `MOST GROUND #${ended.topDistance.tag} · ${ended.topDistance.meters} M`
              : 'TOUCHLINE'
          }
          fs={14}
          k={k}
          font={MONO}
          weight='normal'
          align='right'
          color={DIM2}
          centerIn={20}
        />
      </Group>
    </>
  );
}

// ── Scene dispatch + crossfade ───────────────────────────────────────────────

function SceneChrome({
  hud,
  resolution,
}: {
  hud: FbHudState;
  resolution: Resolution;
}) {
  const k = resolution.height / 1080;
  const scene = hud.stage.scene;
  const replaying = scene === 'replay';
  const liveLike = scene === 'live' || replaying;
  const eventOn = !!hud.lastEvent?.showBanner;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      {scene === 'lobby' ? <LobbyScene hud={hud} k={k} /> : null}
      {scene === 'ended' ? <EndedScene hud={hud} k={k} /> : null}
      {replaying ? (
        <ReplayWindow hud={hud} k={k} resolution={resolution} />
      ) : null}
      {liveLike && !replaying ? (
        <MinimapPlate hud={hud} k={k} resolution={resolution} />
      ) : null}
      {liveLike ? <ScoreBug hud={hud} k={k} /> : null}
      {liveLike ? <PendingPill hud={hud} k={k} /> : null}
      {liveLike && !replaying ? <EventBanner hud={hud} k={k} /> : null}
      {liveLike && !replaying && !eventOn ? <Banner hud={hud} k={k} /> : null}
    </View>
  );
}

/** Scene-level football chrome; crossfades over KBT_VIEW_TRANSITION_MS when the stage changes. */
export function FbMatchHud({
  hud,
  resolution,
}: {
  hud: FbHudState;
  resolution: Resolution;
}) {
  const swapKey = `${hud.stage.scene}|${hud.stage.replay?.inputId ?? ''}`;
  const lastRef = useRef({ key: swapKey, hud });
  const [outgoingState, setOutgoing] = useState<{
    hud: FbHudState;
    startedAtMs: number;
  } | null>(null);
  let outgoing = outgoingState;
  if (lastRef.current.key !== swapKey) {
    outgoing = { hud: lastRef.current.hud, startedAtMs: Date.now() };
    setOutgoing(outgoing);
  }
  lastRef.current = { key: swapKey, hud };
  useEffect(() => {
    if (!outgoing) return;
    const timer = setTimeout(() => setOutgoing(null), KBT_VIEW_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [outgoing]);
  const frame = {
    top: 0,
    left: 0,
    width: resolution.width,
    height: resolution.height,
  };
  return (
    <View style={{ ...frame, overflow: 'visible' }}>
      {outgoing ? (
        <View style={frame}>
          <TransitionShaderWrapper
            transition={{
              type: 'fade',
              durationMs: KBT_VIEW_TRANSITION_MS,
              direction: 'out',
              startedAtMs: outgoing.startedAtMs,
            }}
            resolution={resolution}>
            <SceneChrome hud={outgoing.hud} resolution={resolution} />
          </TransitionShaderWrapper>
        </View>
      ) : null}
      {outgoing ? (
        <View style={frame}>
          <TransitionShaderWrapper
            transition={{
              type: 'fade',
              durationMs: KBT_VIEW_TRANSITION_MS,
              direction: 'in',
              startedAtMs: outgoing.startedAtMs,
            }}
            resolution={resolution}>
            <SceneChrome hud={hud} resolution={resolution} />
          </TransitionShaderWrapper>
        </View>
      ) : (
        <SceneChrome hud={hud} resolution={resolution} />
      )}
    </View>
  );
}
