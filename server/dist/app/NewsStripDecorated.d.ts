import React from 'react';
export type NewsStripDecoratedProps = {
    resolution: {
        width: number;
        height: number;
    };
    opacity?: number;
    amplitudePx?: number;
    wavelengthPx?: number;
    speed?: number;
    phase?: number;
    removeColorTolerance?: number;
    removeColorEnabled?: boolean;
    children?: React.ReactElement;
};
export declare function NewsStripDecorated({ resolution, opacity, amplitudePx, wavelengthPx, speed, phase, removeColorTolerance, removeColorEnabled, children, }: NewsStripDecoratedProps): React.ReactElement<any, string | React.JSXElementConstructor<any>> | undefined;
