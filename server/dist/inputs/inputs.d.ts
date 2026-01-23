import type { InputConfig } from '../app/store';
import React from 'react';
type Resolution = {
    width: number;
    height: number;
};
export declare function Input({ input }: {
    input: InputConfig;
}): React.ReactElement<any, string | React.JSXElementConstructor<any>>;
export declare function SmallInput({ input, resolution, }: {
    input: InputConfig;
    resolution?: Resolution;
}): import("react/jsx-runtime").JSX.Element;
export {};
