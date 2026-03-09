import { View, Rescaler, Image, Text } from '@swmansion/smelter';
import React from 'react';

export type NewsStripTheme = {
  liveBadgeBg: string;
  liveBadgeText: string;
  logoBoxBg: string;
  marqueeBg: string;
  marqueeText: string;
};

export const DEFAULT_THEME: NewsStripTheme = {
  liveBadgeBg: '#F24664',
  liveBadgeText: '#000000',
  logoBoxBg: '#ffffff',
  marqueeBg: '#342956',
  marqueeText: '#ffffff',
};

type NewsStripContentProps = {
  width: number;
  stripHeight: number;
  marqueeLeft: number;
  theme?: NewsStripTheme;
};

export function NewsStripContent({
  width,
  stripHeight,
  marqueeLeft,
  theme = DEFAULT_THEME,
}: NewsStripContentProps) {
  return (
    <View style={{ width, height: stripHeight, direction: 'column' }}>
      {/* left logo box */}
      <View
        style={{
          width: Math.round(width * 0.094),
          height: Math.round(stripHeight * 0.16),
          top: Math.round(stripHeight * 0.25),
          left: 0,
          direction: 'column',
          overflow: 'hidden',
          backgroundColor: theme.liveBadgeBg,
        }}>
        <Text
          style={{
            fontSize: Math.round(stripHeight * 0.09),
            lineHeight: Math.round(stripHeight * 0.16),
            color: theme.liveBadgeText,
            fontFamily: 'Poppins',
            fontWeight: 'bold',
            align: 'center',
            width: Math.round(width * 0.094),
            height: Math.round(stripHeight * 0.16),
          }}>
          LIVE
        </Text>
      </View>
      <View
        style={{
          width: Math.round(width * 0.094),
          height: Math.round(stripHeight * 0.43),
          top: Math.round(stripHeight * 0.41),
          left: 0,
          direction: 'column',
          overflow: 'hidden',
          backgroundColor: theme.logoBoxBg,
        }}>
        <Rescaler style={{ rescaleMode: 'fill', width: Math.round(width * 0.059), height: Math.round(stripHeight * 0.16), top: Math.round(stripHeight * 0.12), left: Math.round(width * 0.02) }}>
          <Image imageId="smelter_logo" />
        </Rescaler>
      </View>
      <View
        style={{
          width: Math.round(width * 0.906),
          height: Math.round(stripHeight * 0.43),
          top: Math.round(stripHeight * 0.41),
          left: Math.round(width * 0.094),
          direction: 'column',
          overflow: 'hidden',
          backgroundColor: theme.marqueeBg,
        }}>
        <View
          style={{
            direction: 'column',
            height: Math.round(stripHeight * 0.43),
            width: Math.round(width * 1.4),
            overflow: 'visible',
            padding: 10,
            top: Math.round(stripHeight * 0.11),
            left: Math.round(marqueeLeft),
          }}>
          <Text
            style={{
              fontSize: Math.round(stripHeight * 0.16),
              width: Math.round(width * 2.7),
              color: theme.marqueeText,
              fontFamily: 'Poppins',
              fontWeight: 'normal',
            }}>
            {'This video is composed of multiple videos and overlays in real time using smelter. Want to learn more? Reach out at contact@smelter.dev.'.toUpperCase()}
          </Text>
        </View>
      </View>
    </View>
  );
}
