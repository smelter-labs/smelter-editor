import type { InputConfig } from '../app/store';
type Resolution = {
    width: number;
    height: number;
};
export declare function Input({ input }: {
    input: InputConfig;
}): import("react/jsx-runtime").JSX.Element;
export declare function SmallInput({ input, resolution, }: {
    input: InputConfig;
    resolution?: Resolution;
}): import("react/jsx-runtime").JSX.Element;
export {};
