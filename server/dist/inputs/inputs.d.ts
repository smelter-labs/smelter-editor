import type { InputConfig } from '../app/store';
import type { ReactElement } from 'react';
type Resolution = {
    width: number;
    height: number;
};
export declare function Input({ input }: {
    input: InputConfig;
}): ReactElement<any, string | import("react").JSXElementConstructor<any>>;
export declare function SmallInput({ input, resolution, }: {
    input: InputConfig;
    resolution?: Resolution;
}): import("react/jsx-runtime").JSX.Element;
export {};
