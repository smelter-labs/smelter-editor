import React, { useEffect, useRef, useState } from 'react';
import { Image, Rescaler, Text, View } from '@swmansion/smelter';
import type { Api } from '@swmansion/smelter';

type TextWeight = Api.TextWeight;
import type { BbHudRect, BbHudState } from '../app/store';
import { KBT_VIEW_TRANSITION_MS } from '../app/store';
import { TransitionShaderWrapper } from './transitionWrapper';
import {
  clockFace,
  monoWidth,
  pipFrameOrigin,
  tagChipRect,
} from './bbHudMetrics';

/**
 * Basketball game ("Blacktop") broadcast chrome — docs/design/blacktop/
 * Blacktop HUD.dc.html. Asphalt plates with one cut corner, chalk text,
 * one electric accent, gold only on the winner; team colours painted at
 * runtime as 16 px stripes / 4 px rules, never under text. Static art
 * comes from scripts/bb-render-assets.mjs (imgs/bb/*.png registered as
 * `bb-<name>`); this file composites the dynamic values on top at the
 * design's 1080p pixel positions scaled by resolution.height/1080.
 *
 * Two kinds of state arrive in one snapshot (see BbHudStage): `stage` follows
 * the layout immediately (which cam is main, where the PiP sits), everything
 * else was held ~3 s to land on the delayed video. Time-based effects use
 * snapshot fields (showBanner) — never live Date.now() age math.
 */

const DISPLAY = 'Big Shoulders Display';
const MONO = 'IBM Plex Mono';
const CHALK = '#F4EFE6';
const CHALK_85 = '#F4EFE6D9';
const DIM = '#F4EFE6B3';
const DIM2 = '#F4EFE680';
const DARK = '#141416';
const ELECTRIC = '#33E1FF';
const GOLD = '#E8B33A';
const GOOD = '#2EE06A';
const AMBER = '#FFD21F';
const BAD = '#FF2E3D';
/** Registered as BigShouldersDisplay-Black.ttf; drop to 'extra_bold' if missing. */
const BLACK: TextWeight = 'black';

type Resolution = { width: number; height: number };

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Pre-rendered design fragment at design-px coords (k = height/1080). */
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

/** Solid rectangle at design-px coords (team colour stripes, rules, veils). */
function Block({
  x,
  y,
  w,
  h,
  k,
  color,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  color: string;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.max(1, Math.round(w * k)),
        height: Math.max(1, Math.round(h * k)),
        backgroundColor: color,
      }}
    />
  );
}

/** Positioned container so children use local design-px coords. */
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

/** Cap-band centre offsets (see KbtHud.tsx for the font-metric derivation). */
const CAP_CENTER: Record<string, number> = { [DISPLAY]: 0.585, [MONO]: 0.68 };

/** One clipped line of text at design-px coords. */
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
  /** Vertically centre the cap band inside this height (design px). */
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

/** Runtime tag chip: coloured block + dark mono 11 text, centred on cx. */
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
  tone: 'electric' | 'amber' | 'chalk' | 'outline';
}) {
  const r = tagChipRect(text, 11, cx, y, 16);
  if (tone === 'outline') {
    return (
      <>
        <Art id='bb-tag-outline' x={r.x} y={r.y} w={r.w} h={r.h} k={k} />
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
  const bg = tone === 'electric' ? ELECTRIC : tone === 'amber' ? AMBER : CHALK;
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
        color={DARK}
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
  electric: ELECTRIC,
  dim: DIM,
} as const;

/** Score bug (70,40) 820×92: stripes + names + scores around the clock cell. */
function ScoreBug({ hud, k }: { hud: BbHudState; k: number }) {
  const face = clockFace(
    hud.clock,
    hud.otWinPoints ?? 2,
    hud.lobby?.durationMs ?? null,
    formatClock,
  );
  const a = hud.teams.A;
  const b = hud.teams.B;
  const scoring =
    hud.stage.scene === 'score' && hud.lastShot && !hud.lastShot.pending
      ? hud.lastShot.team
      : null;
  const mainFs = face.main.length > 5 ? 22 : 30;
  return (
    <Group x={70} y={40} w={820} h={92} k={k}>
      <Art id='bb-scorebug-plate' x={0} y={0} w={820} h={92} k={k} />
      <Block x={0} y={0} w={16} h={92} k={k} color={a.color} />
      {/* B stripe starts under the 18 px corner cut. */}
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
        color={scoring === 'A' ? ELECTRIC : CHALK}
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
        color={scoring === 'B' ? ELECTRIC : CHALK}
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

/** Plate + chip around the picture-in-picture; SIGNAL LOST variant. */
function PipFrame({ hud, k }: { hud: BbHudState; k: number }) {
  const pip = hud.stage.pip;
  if (!pip) return null;
  const o = pipFrameOrigin(pip.rect, k);
  const cam = hud.cams[pip.role];
  const lost = cam.inputId != null && !cam.live;
  const id = lost ? `bb-pip-lost-${pip.role}` : `bb-pip-frame-${pip.role}`;
  return (
    <>
      <Art id={id} x={o.x} y={o.y} w={496} h={320} k={k} />
      {cam.name ? (
        <Label
          x={o.x + 300}
          y={o.y + 8}
          w={180}
          text={cam.name.toUpperCase()}
          fs={12}
          k={k}
          font={MONO}
          weight='medium'
          align='right'
          color={DIM2}
          centerIn={26}
        />
      ) : null}
    </>
  );
}

/** "+2 TEAM" toast under the score bug (outside the featured score scene). */
function ShotToast({ hud, k }: { hud: BbHudState; k: number }) {
  const shot = hud.lastShot;
  if (!shot || !shot.showBanner) return null;
  return (
    <Group x={70} y={150} w={460} h={64} k={k}>
      {shot.pending ? (
        <Art id='bb-toast-refcall' x={0} y={0} w={460} h={64} k={k} />
      ) : (
        <>
          <Art id='bb-toast-plate' x={0} y={0} w={460} h={64} k={k} />
          <Block x={0} y={0} w={64} h={64} k={k} color={shot.color} />
        </>
      )}
      <Label
        x={84}
        y={12}
        w={70}
        text={`+${shot.points}`}
        fs={40}
        k={k}
        weight={BLACK}
        color={ELECTRIC}
        centerIn={40}
      />
      {!shot.pending ? (
        <Label
          x={168}
          y={15}
          w={200}
          text={(shot.teamName ?? '').toUpperCase()}
          fs={34}
          k={k}
          centerIn={36}
        />
      ) : null}
    </Group>
  );
}

/** Makes waiting for the moderator ("AWAITING REF · n"). */
function PendingPill({ hud, k }: { hud: BbHudState; k: number }) {
  if (hud.pendingCount <= 0) return null;
  const y = hud.lastShot?.showBanner && hud.stage.scene !== 'score' ? 230 : 150;
  return (
    <Group x={70} y={y} w={270} h={54} k={k}>
      <Art id='bb-pending-pill' x={0} y={0} w={270} h={54} k={k} />
      <Label
        x={214}
        y={12}
        w={40}
        text={String(hud.pendingCount)}
        fs={30}
        k={k}
        align='right'
        centerIn={32}
        color={ELECTRIC}
      />
    </Group>
  );
}

/** Full-frame SCORE! card over the featured hoop cam + the release still. */
function ScoreBanner({ hud, k }: { hud: BbHudState; k: number }) {
  const shot = hud.lastShot;
  if (!shot || !shot.showBanner) return null;
  const pip = hud.stage.pip;
  const still = pip ? pipFrameOrigin(pip.rect, k) : { x: 1368, y: 704 };
  return (
    <>
      <Group x={460} y={320} w={1000} h={290} k={k}>
        <Art id='bb-banner-score' x={0} y={0} w={1000} h={290} k={k} />
        <Block
          x={0}
          y={0}
          w={16}
          h={290}
          k={k}
          color={shot.pending ? CHALK : shot.color}
        />
        <Label
          x={250}
          y={214}
          w={90}
          text={`+${shot.points}`}
          fs={54}
          k={k}
          weight={BLACK}
          align='right'
          color={ELECTRIC}
          centerIn={60}
        />
        <Label
          x={360}
          y={214}
          w={500}
          text={
            shot.pending ? '· REF CALL' : (shot.teamName ?? '').toUpperCase()
          }
          fs={54}
          k={k}
          color={shot.pending ? ELECTRIC : CHALK}
          centerIn={60}
        />
      </Group>
      {shot.frameImageId ? (
        <>
          <Art
            id={shot.frameImageId}
            x={still.x + 8}
            y={still.y + 42}
            w={480}
            h={270}
            k={k}
          />
          <Art
            id='bb-still-frame'
            x={still.x}
            y={still.y}
            w={496}
            h={320}
            k={k}
          />
        </>
      ) : null}
    </>
  );
}

/** Lead change / overtime / final banner (bottom centre, 510,880 900×84). */
function Banner({ hud, k }: { hud: BbHudState; k: number }) {
  const banner = hud.banner;
  if (!banner) return null;
  const draw = banner.kind === 'final' && banner.text.startsWith('FINAL');
  const textColor =
    banner.kind === 'overtime'
      ? AMBER
      : banner.kind === 'final' && !draw
        ? GOLD
        : CHALK;
  const weight: TextWeight = banner.kind === 'overtime' ? BLACK : 'bold';
  return (
    <Group x={510} y={880} w={900} h={84} k={k}>
      <Art id='bb-banner-plate' x={0} y={0} w={900} h={84} k={k} />
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

// ── Commentator ──────────────────────────────────────────────────────────────

function CasterLowerThird({ hud, k }: { hud: BbHudState; k: number }) {
  const rect: BbHudRect | null = hud.stage.caster;
  const c = hud.commentator;
  if (!rect || !c) return null;
  const cx = rect.x / k;
  const cy = rect.y / k;
  const cw = rect.width / k;
  const ch = rect.height / k;
  const plateX = cx + cw + 12;
  const plateY = cy + ch - 88;
  return (
    <>
      {!c.camConnected ? (
        <Group x={cx} y={cy} w={cw} h={ch} k={k}>
          <Block x={0} y={0} w={cw} h={ch} k={k} color='#141416CC' />
          <Label
            x={0}
            w={cw}
            text='NO SIGNAL'
            fs={16}
            k={k}
            font={MONO}
            weight='semi_bold'
            align='center'
            centerIn={ch}
            color={BAD}
          />
        </Group>
      ) : null}
      <Art
        id='bb-caster-onair'
        x={plateX}
        y={plateY - 42}
        w={130}
        h={36}
        k={k}
      />
      <Art id='bb-caster-plate' x={plateX} y={plateY} w={470} h={88} k={k} />
      <Label
        x={plateX + 24}
        y={plateY + 14}
        w={420}
        text={c.name.toUpperCase()}
        fs={36}
        k={k}
        centerIn={40}
      />
    </>
  );
}

/** Audio-only commentary: a small ON AIR chip bottom-left. */
function CasterOnAirMini({ hud, k }: { hud: BbHudState; k: number }) {
  const c = hud.commentator;
  if (!c || !c.camConnected) return null;
  return <Art id='bb-caster-onair' x={70} y={974} w={130} h={36} k={k} />;
}

/** Commentator full-frame: chip + name plate bottom-left. */
function CasterFullScene({ hud, k }: { hud: BbHudState; k: number }) {
  const c = hud.commentator;
  if (!c) return null;
  return (
    <>
      <Art id='bb-caster-onair' x={70} y={850} w={130} h={36} k={k} />
      <Art id='bb-caster-plate' x={70} y={892} w={470} h={88} k={k} />
      <Label
        x={94}
        y={906}
        w={420}
        text={c.name.toUpperCase()}
        fs={36}
        k={k}
        centerIn={40}
      />
    </>
  );
}

// ── Lobby / ended ────────────────────────────────────────────────────────────

const LOBBY_ROLES = ['hoop', 'court', 'commentator'] as const;

function LobbyScene({ hud, k }: { hud: BbHudState; k: number }) {
  const lobby = hud.lobby;
  if (!lobby) return null;
  return (
    <>
      <Art id='bb-lobby-scrim' x={0} y={0} w={1920} h={1080} k={k} />
      <Art id='bb-lobby-title' x={70} y={60} w={760} h={150} k={k} />
      <Art id='bb-lobby-tag' x={1150} y={40} w={700} h={220} k={k} />
      <Group x={370} y={620} w={1180} h={400} k={k}>
        <Art id='bb-lobby-panel' x={0} y={0} w={1180} h={400} k={k} />
        {LOBBY_ROLES.map((role, i) => {
          const col = 32 + i * 384;
          const qr = lobby.qr[role];
          const cam =
            role === 'commentator'
              ? null
              : lobby.cams.find((c) => c.role === role);
          const joined =
            role === 'commentator'
              ? lobby.commentatorName != null
              : !!cam?.joined;
          const live = role === 'commentator' ? joined : !!cam?.live;
          const status = !joined
            ? '○ WAITING FOR PHONE'
            : live
              ? role === 'commentator'
                ? '● JOINED'
                : '● LIVE'
              : '◌ CONNECTING';
          const statusColor = !joined ? DIM : live ? GOOD : AMBER;
          const name =
            role === 'commentator'
              ? (lobby.commentatorName ?? '')
              : (cam?.name ?? '');
          return (
            <React.Fragment key={role}>
              {qr.imageId ? (
                <Art id={qr.imageId} x={col} y={84} w={150} h={150} k={k} />
              ) : null}
              <Label
                x={col + 170}
                y={120}
                w={180}
                text={status}
                fs={11}
                k={k}
                font={MONO}
                weight='semi_bold'
                color={statusColor}
                centerIn={16}
              />
              <Label
                x={col + 170}
                y={146}
                w={180}
                text={name}
                fs={22}
                k={k}
                font={MONO}
                weight='medium'
                centerIn={28}
              />
              {role === 'hoop' && joined ? (
                <Label
                  x={col + 170}
                  y={222}
                  w={180}
                  text={
                    cam?.calibrated ? 'RIM CALIBRATED' : 'CALIBRATE THE RIM'
                  }
                  fs={11}
                  k={k}
                  font={MONO}
                  weight='semi_bold'
                  color={cam?.calibrated ? GOOD : AMBER}
                  centerIn={14}
                />
              ) : null}
              {qr.label ? (
                <Label
                  x={col + 170}
                  y={248}
                  w={180}
                  text={qr.label}
                  fs={11}
                  k={k}
                  font={MONO}
                  weight='normal'
                  color={DIM2}
                  centerIn={14}
                />
              ) : null}
            </React.Fragment>
          );
        })}
        {/* teams + rules strip */}
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
          text={`FIRST TO ${lobby.targetPoints} · ${formatClock(lobby.durationMs)} · OT TO +${hud.otWinPoints ?? 2}`}
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

function pct(makes: number, attempts: number): string {
  if (attempts <= 0) return '—';
  return `${Math.round((makes / attempts) * 100)}`;
}

function EndedScene({ hud, k }: { hud: BbHudState; k: number }) {
  const ended = hud.ended;
  if (!ended) return null;
  const winnerName = ended.winner
    ? hud.teams[ended.winner].name.toUpperCase()
    : null;
  const headline = winnerName ? `${winnerName} WINS` : 'FINAL — DRAW';
  const rest = ` · LEAD CHANGES ${ended.leadChanges} · ${ended.otPlayed ? 'OVERTIME' : 'FULL TIME'}`;
  const headW = monoWidth(headline, 14);
  return (
    <>
      <Block x={0} y={0} w={1920} h={1080} k={k} color='#141416D1' />
      <Group x={360} y={180} w={1200} h={720} k={k}>
        <Art id='bb-ended-panel' x={0} y={0} w={1200} h={720} k={k} />
        {(['A', 'B'] as const).map((team, i) => {
          const right = i === 1;
          const t = hud.teams[team];
          const s = ended.teams[team];
          const win = ended.winner === team;
          const cells: string[] = [
            String(s.makes),
            String(s.attempts),
            pct(s.makes, s.attempts),
            String(s.twos),
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
                  id='bb-winner-tag'
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
                <Label
                  key={c}
                  x={right ? 1114 - 110 - c * 120 : 86 + c * 120}
                  y={586}
                  w={110}
                  text={value}
                  fs={36}
                  k={k}
                  align={right ? 'right' : 'left'}
                  centerIn={40}
                />
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
          text={winnerName ? 'CHAMPION OF THE BLACKTOP' : 'NO WINNER · NO GOLD'}
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
  hud: BbHudState;
  resolution: Resolution;
}) {
  const k = resolution.height / 1080;
  const scene = hud.stage.scene;
  const liveLike =
    scene === 'live' ||
    scene === 'score' ||
    scene === 'hoop' ||
    scene === 'court' ||
    scene === 'split';
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
      {liveLike ? <ScoreBug hud={hud} k={k} /> : null}
      {liveLike ? <PipFrame hud={hud} k={k} /> : null}
      {liveLike && scene !== 'score' ? <ShotToast hud={hud} k={k} /> : null}
      {liveLike ? <PendingPill hud={hud} k={k} /> : null}
      {scene === 'score' ? <ScoreBanner hud={hud} k={k} /> : null}
      {(liveLike && scene !== 'score') || scene === 'caster' ? (
        <Banner hud={hud} k={k} />
      ) : null}
      {scene === 'caster' ? <CasterFullScene hud={hud} k={k} /> : null}
      {scene === 'caster' ? <ScoreBug hud={hud} k={k} /> : null}
      {hud.stage.caster ? (
        <CasterLowerThird hud={hud} k={k} />
      ) : liveLike ? (
        <CasterOnAirMini hud={hud} k={k} />
      ) : null}
    </View>
  );
}

/**
 * Scene-level basketball chrome, mounted once above all layers. Layout cuts
 * are hard (the predictive cut wants the hoop cam NOW); the chrome crossfades
 * over KBT_VIEW_TRANSITION_MS when the stage changes so plates don't pop.
 */
export function BbMatchHud({
  hud,
  resolution,
}: {
  hud: BbHudState;
  resolution: Resolution;
}) {
  const swapKey = `${hud.stage.scene}|${hud.stage.pip?.role ?? ''}|${hud.stage.caster ? 1 : 0}`;
  const lastRef = useRef({ key: swapKey, hud });
  const [outgoing, setOutgoing] = useState<{
    hud: BbHudState;
    startedAtMs: number;
  } | null>(null);

  useEffect(() => {
    if (lastRef.current.key !== swapKey) {
      setOutgoing({ hud: lastRef.current.hud, startedAtMs: Date.now() });
    }
    lastRef.current = { key: swapKey, hud };
  });

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
