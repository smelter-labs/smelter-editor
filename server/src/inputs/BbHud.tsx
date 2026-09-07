import React, { useEffect, useRef, useState } from 'react';
import { Image, Rescaler, Text, View } from '@swmansion/smelter';
import type { BbHudRect, BbHudState } from '../app/store';
import { KBT_VIEW_TRANSITION_MS } from '../app/store';
import { TransitionShaderWrapper } from './transitionWrapper';

/**
 * Basketball game ("Blacktop") broadcast chrome: asphalt plates, chalk rules,
 * orange accent, team colours painted at runtime. Static art comes from
 * scripts/bb-render-assets.mjs (imgs/bb/*.png registered as `bb-<name>`);
 * this file composites the dynamic values on top. Coordinates are the
 * design's 1080p pixel values scaled by resolution.height/1080.
 *
 * Two kinds of state arrive in one snapshot (see BbHudStage): `stage` follows
 * the layout immediately (which cam is main, where the PiP sits), everything
 * else was held ~3 s to land on the delayed video. Time-based effects use
 * snapshot fields (showBanner) — never live Date.now() age math.
 */

const DISPLAY = 'Big Shoulders Display';
const MONO = 'IBM Plex Mono';
const ORANGE = '#FF6A1F';
const CHALK = '#F4EFE6';
const DIM = '#F4EFE68C';
const GOOD = '#2EE06A';
const AMBER = '#FFD21F';
const BAD = '#FF2E3D';

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

/** Solid rectangle at design-px coords (team colour bars, veils). */
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
  weight = 'bold',
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
  weight?: 'normal' | 'medium' | 'semi_bold' | 'bold' | 'extra_bold';
  align?: 'left' | 'center' | 'right';
  centerIn?: number;
}) {
  const width = Math.round(w * k);
  const top =
    centerIn != null ? centerIn / 2 - (CAP_CENTER[font] ?? 0.585) * fs : y;
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

// ── Live chrome ──────────────────────────────────────────────────────────────

function clockText(hud: BbHudState): {
  main: string;
  tag: string;
  tagColor: string;
} {
  const c = hud.clock;
  switch (c.phase) {
    case 'lobby':
      return {
        main: formatClock(hud.lobby?.durationMs ?? c.remainingMs),
        tag: 'WARM-UP',
        tagColor: DIM,
      };
    case 'paused':
      return {
        main: formatClock(c.remainingMs),
        tag: 'PAUSED',
        tagColor: AMBER,
      };
    case 'overtime':
      return { main: 'OT', tag: 'FIRST TO +2', tagColor: ORANGE };
    case 'ended':
      return {
        main: 'FINAL',
        tag: c.period === 'ot' ? 'AFTER OT' : 'FULL TIME',
        tagColor: ORANGE,
      };
    default:
      return {
        main: formatClock(c.remainingMs),
        tag: c.period === 'ot' ? 'OT' : 'REG',
        tagColor: DIM,
      };
  }
}

/** Score bug: team colours + names + scores around the clock (top-left). */
function ScoreBug({ hud, k }: { hud: BbHudState; k: number }) {
  const { main, tag, tagColor } = clockText(hud);
  const a = hud.teams.A;
  const b = hud.teams.B;
  return (
    <Group x={70} y={40} w={820} h={92} k={k}>
      <Art id='bb-scorebug-plate' x={0} y={0} w={820} h={92} k={k} />
      <Block x={0} y={0} w={16} h={92} k={k} color={a.color} />
      <Block x={804} y={0} w={16} h={92} k={k} color={b.color} />
      <Label
        x={32}
        w={190}
        text={a.name.toUpperCase()}
        fs={26}
        k={k}
        centerIn={92}
      />
      <Label
        x={214}
        w={106}
        text={String(a.score)}
        fs={58}
        k={k}
        weight='extra_bold'
        align='right'
        centerIn={92}
      />
      <Label
        x={340}
        y={14}
        w={124}
        text={main}
        fs={main.length > 5 ? 22 : 30}
        k={k}
        font={MONO}
        weight='semi_bold'
        align='center'
      />
      <Label
        x={340}
        y={58}
        w={124}
        text={tag}
        fs={11}
        k={k}
        font={MONO}
        weight='medium'
        align='center'
        color={tagColor}
      />
      <Label
        x={484}
        w={106}
        text={String(b.score)}
        fs={58}
        k={k}
        weight='extra_bold'
        centerIn={92}
      />
      <Label
        x={582}
        w={190}
        text={b.name.toUpperCase()}
        fs={26}
        k={k}
        align='right'
        centerIn={92}
      />
    </Group>
  );
}

/** Chalk frame + role tag around the picture-in-picture, plus SIGNAL LOST. */
function PipFrame({ hud, k }: { hud: BbHudState; k: number }) {
  const pip = hud.stage.pip;
  if (!pip) return null;
  // The rect is in output pixels; the frame art is 496×320 design px with
  // the 480×270 window at (8, 42).
  const x = pip.rect.x / k - 8;
  const y = pip.rect.y / k - 42;
  const cam = hud.cams[pip.role];
  const lost = cam.inputId != null && !cam.live;
  return (
    <>
      {lost ? (
        <Group x={pip.rect.x / k} y={pip.rect.y / k} w={480} h={270} k={k}>
          <Block x={0} y={0} w={480} h={270} k={k} color='#141416CC' />
          <Label
            x={0}
            w={480}
            text='SIGNAL LOST'
            fs={30}
            k={k}
            align='center'
            centerIn={270}
            color={BAD}
          />
        </Group>
      ) : null}
      <Art id={`bb-pip-frame-${pip.role}`} x={x} y={y} w={496} h={320} k={k} />
    </>
  );
}

/** "+1 TEAM" toast under the score bug (outside the featured score scene). */
function ShotToast({ hud, k }: { hud: BbHudState; k: number }) {
  const shot = hud.lastShot;
  if (!shot || !shot.showBanner) return null;
  const text = shot.pending
    ? `+${shot.points} · REF CALL`
    : `+${shot.points} ${(shot.teamName ?? '').toUpperCase()}`;
  return (
    <Group x={70} y={150} w={460} h={64} k={k}>
      <Art id='bb-toast-plate' x={0} y={0} w={460} h={64} k={k} />
      <Block
        x={0}
        y={0}
        w={14}
        h={64}
        k={k}
        color={shot.pending ? CHALK : shot.color}
      />
      <Label
        x={34}
        w={400}
        text={text}
        fs={34}
        k={k}
        weight='extra_bold'
        centerIn={64}
        color={shot.pending ? CHALK : shot.color}
      />
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
        x={190}
        w={60}
        text={String(hud.pendingCount)}
        fs={30}
        k={k}
        weight='extra_bold'
        align='right'
        centerIn={54}
        color={ORANGE}
      />
    </Group>
  );
}

/** Full-frame SCORE! card over the featured hoop cam + the release still. */
function ScoreBanner({ hud, k }: { hud: BbHudState; k: number }) {
  const shot = hud.lastShot;
  if (!shot || !shot.showBanner) return null;
  const color = shot.pending ? CHALK : shot.color;
  const line = shot.pending
    ? `+${shot.points} · REF CALL`
    : `+${shot.points}  ${(shot.teamName ?? '').toUpperCase()}`;
  return (
    <>
      <Group x={460} y={320} w={1000} h={290} k={k}>
        <Block x={0} y={0} w={1000} h={10} k={k} color={color} />
        <Art id='bb-banner-score' x={0} y={10} w={1000} h={280} k={k} />
        <Label
          x={0}
          y={196}
          w={1000}
          text={line}
          fs={60}
          k={k}
          weight='extra_bold'
          align='center'
          color={color}
        />
      </Group>
      {shot.frameImageId ? (
        <>
          <Art id={shot.frameImageId} x={1378} y={708} w={480} h={270} k={k} />
          <Art id='bb-still-frame' x={1370} y={666} w={496} h={320} k={k} />
        </>
      ) : null}
    </>
  );
}

/** Lead change / overtime / final / hype banner (bottom centre). */
function Banner({ hud, k }: { hud: BbHudState; k: number }) {
  const banner = hud.banner;
  if (!banner) return null;
  return (
    <Group x={510} y={880} w={900} h={84} k={k}>
      <Art id='bb-banner-plate' x={0} y={0} w={900} h={84} k={k} />
      <Block x={0} y={0} w={900} h={4} k={k} color={banner.color} />
      <Label
        x={20}
        w={860}
        text={banner.text.toUpperCase()}
        fs={44}
        k={k}
        weight='extra_bold'
        align='center'
        centerIn={84}
        color={banner.color}
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
      {/* chalk frame around the cam tile */}
      <Block x={cx - 4} y={cy - 4} w={cw + 8} h={4} k={k} color={CHALK} />
      <Block x={cx - 4} y={cy + ch} w={cw + 8} h={4} k={k} color={CHALK} />
      <Block x={cx - 4} y={cy} w={4} h={ch} k={k} color={CHALK} />
      <Block x={cx + cw} y={cy} w={4} h={ch} k={k} color={CHALK} />
      {!c.camConnected ? (
        <Group x={cx} y={cy} w={cw} h={ch} k={k}>
          <Block x={0} y={0} w={cw} h={ch} k={k} color='#141416CC' />
          <Label
            x={0}
            w={cw}
            text='NO SIGNAL'
            fs={16}
            k={k}
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
        x={plateX + 30}
        y={plateY + 12}
        w={420}
        text={c.name.toUpperCase()}
        fs={36}
        k={k}
        weight='extra_bold'
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

/** Commentator full-frame: name plate bottom-left. */
function CasterFullScene({ hud, k }: { hud: BbHudState; k: number }) {
  const c = hud.commentator;
  if (!c) return null;
  return (
    <>
      <Art id='bb-caster-onair' x={70} y={880} w={130} h={36} k={k} />
      <Art id='bb-caster-plate' x={70} y={922} w={470} h={88} k={k} />
      <Label
        x={100}
        y={934}
        w={420}
        text={c.name.toUpperCase()}
        fs={36}
        k={k}
        weight='extra_bold'
      />
    </>
  );
}

// ── Lobby / ended ────────────────────────────────────────────────────────────

const LOBBY_ROLES = ['hoop', 'court', 'commentator'] as const;

function LobbyScene({ hud, k }: { hud: BbHudState; k: number }) {
  const lobby = hud.lobby;
  if (!lobby) return null;
  const PX = 370;
  const PY = 620;
  return (
    <>
      <Block x={0} y={0} w={1920} h={1080} k={k} color='#14141699' />
      <Art id='bb-lobby-title' x={70} y={60} w={760} h={150} k={k} />
      <Group x={PX} y={PY} w={1180} h={400} k={k}>
        <Art id='bb-lobby-panel' x={0} y={0} w={1180} h={400} k={k} />
        {LOBBY_ROLES.map((role, i) => {
          const col = 40 + i * 380;
          const qr = lobby.qr[role];
          const cam =
            role === 'commentator'
              ? null
              : lobby.cams.find((c) => c.role === role);
          const joined =
            role === 'commentator'
              ? lobby.commentatorName != null
              : !!cam?.joined;
          const live = role === 'commentator' ? false : !!cam?.live;
          const status = !joined
            ? 'WAITING FOR PHONE'
            : role === 'commentator'
              ? 'JOINED'
              : live
                ? 'LIVE'
                : 'CONNECTING';
          const statusColor = !joined
            ? DIM
            : live || role === 'commentator'
              ? GOOD
              : AMBER;
          const name =
            role === 'commentator'
              ? (lobby.commentatorName ?? '')
              : (cam?.name ?? '');
          return (
            <React.Fragment key={role}>
              {qr.imageId ? (
                <Art id={qr.imageId} x={col} y={95} w={150} h={150} k={k} />
              ) : null}
              <Label
                x={col + 190}
                y={104}
                w={170}
                text={status}
                fs={13}
                k={k}
                font={MONO}
                weight='semi_bold'
                color={statusColor}
              />
              <Label
                x={col + 190}
                y={130}
                w={170}
                text={name.toUpperCase()}
                fs={24}
                k={k}
              />
              {role === 'hoop' ? (
                <Label
                  x={col + 190}
                  y={168}
                  w={170}
                  text={
                    cam?.calibrated ? 'RIM CALIBRATED' : 'CALIBRATE THE RIM'
                  }
                  fs={12}
                  k={k}
                  font={MONO}
                  weight='medium'
                  color={cam?.calibrated ? GOOD : ORANGE}
                />
              ) : null}
              {qr.label ? (
                <Label
                  x={col + 190}
                  y={268}
                  w={170}
                  text={qr.label}
                  fs={12}
                  k={k}
                  font={MONO}
                  weight='medium'
                  color={DIM}
                />
              ) : null}
            </React.Fragment>
          );
        })}
        {/* teams + rules strip */}
        <Block x={40} y={332} w={10} h={28} k={k} color={hud.teams.A.color} />
        <Label
          x={62}
          y={328}
          w={260}
          text={hud.teams.A.name.toUpperCase()}
          fs={28}
          k={k}
        />
        <Label
          x={330}
          y={336}
          w={40}
          text='VS'
          fs={13}
          k={k}
          font={MONO}
          weight='semi_bold'
          color={DIM}
        />
        <Block x={380} y={332} w={10} h={28} k={k} color={hud.teams.B.color} />
        <Label
          x={402}
          y={328}
          w={260}
          text={hud.teams.B.name.toUpperCase()}
          fs={28}
          k={k}
        />
        <Label
          x={740}
          y={336}
          w={400}
          text={`FIRST TO ${lobby.targetPoints} · ${formatClock(lobby.durationMs)} · OT TO +2`}
          fs={13}
          k={k}
          font={MONO}
          weight='semi_bold'
          align='right'
          color={DIM}
        />
      </Group>
    </>
  );
}

function pct(makes: number, attempts: number): string {
  if (attempts <= 0) return '—';
  return `${Math.round((makes / attempts) * 100)}%`;
}

function EndedScene({ hud, k }: { hud: BbHudState; k: number }) {
  const ended = hud.ended;
  if (!ended) return null;
  const PX = 360;
  const PY = 180;
  return (
    <>
      <Block x={0} y={0} w={1920} h={1080} k={k} color='#141416B0' />
      <Group x={PX} y={PY} w={1200} h={720} k={k}>
        <Art id='bb-ended-panel' x={0} y={0} w={1200} h={720} k={k} />
        {(['A', 'B'] as const).map((team, i) => {
          const col = 60 + i * 600;
          const t = hud.teams[team];
          const s = ended.teams[team];
          const win = ended.winner === team;
          const rows: [string, string][] = [
            ['MAKES', String(s.makes)],
            ['ATTEMPTS', String(s.attempts)],
            ['FG%', pct(s.makes, s.attempts)],
            ['TWOS', String(s.twos)],
          ];
          return (
            <React.Fragment key={team}>
              <Block x={col} y={120} w={480} h={10} k={k} color={t.color} />
              <Label
                x={col}
                y={150}
                w={340}
                text={t.name.toUpperCase()}
                fs={40}
                k={k}
              />
              {win ? (
                <Label
                  x={col + 300}
                  y={160}
                  w={180}
                  text='WINNER'
                  fs={16}
                  k={k}
                  font={MONO}
                  weight='semi_bold'
                  align='right'
                  color={ORANGE}
                />
              ) : null}
              <Label
                x={col}
                y={200}
                w={480}
                text={String(s.score)}
                fs={190}
                k={k}
                weight='extra_bold'
                color={win ? t.color : CHALK}
              />
              {rows.map(([label, value], r) => (
                <Label
                  key={label}
                  x={col + 240}
                  y={422 + r * 48}
                  w={240}
                  text={value}
                  fs={30}
                  k={k}
                  align='right'
                />
              ))}
            </React.Fragment>
          );
        })}
        <Label
          x={60}
          y={648}
          w={1080}
          text={`${ended.winner ? `${hud.teams[ended.winner].name.toUpperCase()} WINS` : 'DRAW'} · LEAD CHANGES ${ended.leadChanges}${ended.otPlayed ? ' · OVERTIME' : ''}`}
          fs={16}
          k={k}
          font={MONO}
          weight='semi_bold'
          color={DIM}
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
