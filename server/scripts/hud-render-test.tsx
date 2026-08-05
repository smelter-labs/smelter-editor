/**
 * Renders the Duck Hunter HUD elements (crosshair + scoreboard row) to an MP4
 * with a second Smelter instance, so the visual bugs can be inspected offline.
 */
import { readFile } from 'fs-extra';
import path from 'path';
import React from 'react';
import Smelter from '@swmansion/smelter-node';
import { Text, View } from '@swmansion/smelter';

const SERVER_DIR = '/Users/piotrruszczak/workspace/streaming/smeltest/server';
const OUT = process.argv[2] ?? '/tmp/hud-test.mp4';

const W = 1280;
const H = 720;

function Crosshair({ px, py, color }: { px: number; py: number; color: string }) {
  const chSize = Math.max(28, Math.round(W * 0.05));
  const th = Math.max(2, Math.round(chSize * 0.06));
  const u = Math.max(3, th);
  const d = Math.round(chSize * 0.58);
  const lineLen = Math.round(chSize * 0.34);
  const dot = Math.round(u * 1.4);
  const mid = Math.round(chSize / 2 - u / 2);
  return (
    <View
      style={{
        top: Math.round(py - chSize / 2),
        left: Math.round(px - chSize / 2),
        width: chSize,
        height: chSize,
        overflow: 'visible',
      }}>
      <View
        style={{
          top: Math.round((chSize - d) / 2),
          left: Math.round((chSize - d) / 2),
          width: d,
          height: d,
          borderWidth: u,
          borderColor: color,
          rotation: 45,
        }}
      />
      <View style={{ top: 0, left: mid, width: u, height: lineLen, backgroundColor: color }} />
      <View style={{ top: chSize - lineLen, left: mid, width: u, height: lineLen, backgroundColor: color }} />
      <View style={{ top: mid, left: 0, width: lineLen, height: u, backgroundColor: color }} />
      <View style={{ top: mid, left: chSize - lineLen, width: lineLen, height: u, backgroundColor: color }} />
      <View
        style={{
          top: Math.round(chSize / 2 - dot / 2),
          left: Math.round(chSize / 2 - dot / 2),
          width: dot,
          height: dot,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Mirrors ShooterScoreboard geometry for one row, cam tile as solid color. */
function ScoreRow() {
  const parent = { width: W, height: H };
  const margin = Math.round(parent.width * 0.02);
  const fs = Math.max(18, Math.round(parent.height * 0.03));
  const padH = Math.round(fs * 0.6);
  const padV = Math.round(fs * 0.5);
  const av = Math.round(fs * 1.9 * 2.5);
  const rowH = Math.round(av * 1.12);
  const rankW = Math.round(fs * 1.5);
  const gap = Math.round(fs * 0.4);
  const scoreW = Math.round(fs * 2.4);
  const pipSize = Math.max(5, Math.round(fs * 0.3));
  const nameLeft = padH + rankW + av + gap;
  const rowOverhead = nameLeft + gap + scoreW + padH;
  const nameW = Math.round(Math.max(parent.width * 0.24 - rowOverhead, fs * 5) * 1.35);
  const width = Math.round(rowOverhead + nameW);
  const height = padV * 2 + rowH;
  const nameH = Math.round(fs * 1.3);
  const pipRowGap = Math.round(fs * 0.35);
  const pipGap = Math.max(2, Math.round(pipSize * 0.5));
  const textColH = nameH + pipRowGap + pipSize + Math.max(2, Math.round(pipSize * 0.4)) + Math.max(2, Math.round(pipSize * 0.3));
  const textTop = Math.round((rowH - textColH) / 2);
  const color = '#FFDE59';
  return (
    <View
      style={{
        top: margin,
        left: parent.width - width - margin,
        width,
        height,
        backgroundColor: '#000000B8',
        borderWidth: Math.max(3, Math.round(fs * 0.16)),
        borderColor: '#FFFFFF',
        overflow: 'hidden',
      }}>
      <View style={{ top: padV, left: 0, width, height: rowH, overflow: 'visible' }}>
        <View style={{ top: Math.round((rowH - fs * 1.2) / 2), left: padH, width: rankW, height: Math.round(fs * 1.3), overflow: 'visible' }}>
          <Text style={{ fontSize: fs, color: '#FFD700', fontFamily: 'Doto', fontWeight: 'black' }}>1</Text>
        </View>
        <View
          style={{
            top: Math.round((rowH - av) / 2),
            left: padH + rankW,
            width: av,
            height: av,
            borderWidth: Math.max(2, Math.round(av * 0.06)),
            borderColor: color,
            backgroundColor: '#333333',
            overflow: 'hidden',
          }}
        />
        <View style={{ top: textTop, left: nameLeft, width: Math.max(fs, nameW), height: nameH, overflow: 'hidden' }}>
          <Text style={{ fontSize: fs, color, fontFamily: 'Doto', fontWeight: 'bold' }}>Piotr Snow</Text>
        </View>
        {Array.from({ length: 5 }).map((_, i) => (
          <View
            key={`pip-${i}`}
            style={{
              top: textTop + nameH + pipRowGap,
              left: nameLeft + i * (pipSize + pipGap),
              width: pipSize,
              height: pipSize,
              backgroundColor: i < 4 ? '#FFDE59' : '#FFFFFF3C',
            }}
          />
        ))}
        <View style={{ top: Math.round((rowH - fs * 1.5) / 2), left: width - padH - scoreW, width: scoreW, height: Math.round(fs * 1.6), overflow: 'hidden' }}>
          <Text style={{ fontSize: Math.round(fs * 1.3), color: '#FFFFFF', align: 'right', width: scoreW, fontFamily: 'Doto', fontWeight: 'black' }}>0</Text>
        </View>
      </View>
    </View>
  );
}

function Scene() {
  return (
    <View style={{ width: W, height: H, backgroundColor: '#8899AA' }}>
      <Crosshair px={W * 0.3} py={H * 0.6} color='#FFDE59' />
      <Crosshair px={W * 0.55} py={H * 0.4} color='#FF5555' />
      <ScoreRow />
    </View>
  );
}

async function main() {
  const smelter = new Smelter();
  await smelter.init();

  const registerFonts = process.env.TEST_FONTS === '1';
  if (registerFonts) {
    const fontFiles = [
      'fonts/doto/Doto-Regular.ttf',
      'fonts/doto/Doto-Bold.ttf',
      'fonts/doto/Doto-Black.ttf',
    ];
    for (const f of fontFiles) {
      const font = await readFile(path.join(SERVER_DIR, f));
      await smelter.registerFont(
        font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
      );
      console.log(`registered font ${f}`);
    }
  }

  await smelter.registerOutput('out', <Scene />, {
    type: 'mp4',
    serverPath: OUT,
    video: {
      encoder: { type: 'ffmpeg_h264', preset: 'ultrafast' },
      resolution: { width: W, height: H },
    },
  });
  await smelter.start();
  await new Promise((r) => setTimeout(r, 1500));
  await smelter.unregisterOutput('out');
  await smelter.terminate();
  console.log(`done → ${OUT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
