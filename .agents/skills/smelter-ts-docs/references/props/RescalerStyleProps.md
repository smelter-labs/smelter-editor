# RescalerStyleProps

Styling properties for the `Rescaler` component.

```tsx
type RescalerStyleProps = {
    rescaleMode?: "fit" | "fill";           // default: "fit"
    horizontalAlign?: "left" | "right" | "justified" | "center";  // default: "center"
    verticalAlign?: "top" | "center" | "bottom" | "justified";    // default: "center"
    width?: number;
    height?: number;
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
    rotation?: number;
    borderRadius?: number;
    borderWidth?: number;
    borderColor?: string;
    boxShadow?: BoxShadow[];
}

type BoxShadow = {
    offsetX?: number;
    offsetY?: number;
    color?: string;      // #RRGGBB or #RRGGBBAA
    blurRadius?: number;
}
```

## Properties

### rescaleMode
How the child is resized:
- `"fit"` (default) — resizes to match one dimension, fully visible (may have empty space)
- `"fill"` — covers entire parent area, excess is clipped

### horizontalAlign
Horizontal alignment of the child within the rescaler. Default: `"center"`.

### verticalAlign
Vertical alignment of the child within the rescaler. Default: `"center"`.

### width
Width in pixels. **Required** when parent is not a layout component.

### height
Height in pixels. **Required** when parent is not a layout component.

### top / left / bottom / right
Distance in pixels from corresponding parent edge. Makes the component **absolutely positioned**.

### rotation
Rotation in degrees. Makes the component absolutely positioned.

### borderRadius
Radius of rounded corners in pixels. Default: `0`.

### borderWidth
Border width in pixels. Default: `0`.

### borderColor
Border color in `#RRGGBB` or `#RRGGBBAA` format. Default: `#00000000` (transparent).

### boxShadow
Array of box shadows applied to the container. Each shadow has `offsetX`, `offsetY`, `color`, and `blurRadius`.
