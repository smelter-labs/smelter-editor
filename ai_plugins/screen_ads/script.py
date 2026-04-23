import os
import cv2
import time
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from PIL import Image

from itertools import combinations
from rectangle_detection import (
    filter_hough_lines_for_rectangle,
    draw_clusters,
    estimate_quadrilateral_corners_from_clusters,
    estimate_quadrilateral_candidates_from_clusters,
    draw_quadrilateral_candidates,
    draw_quadrilateral_and_corners,
    mask_image_inside_quadrilateral,
)


def fill_holes_not_connected_to_edges(binary_image):
    binary = np.where(binary_image > 0, 255, 0).astype(np.uint8)
    inv = cv2.bitwise_not(binary)

    padded = cv2.copyMakeBorder(inv, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=255)
    flood = padded.copy()
    flood_mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), dtype=np.uint8)
    cv2.floodFill(flood, flood_mask, (0, 0), 128)

    inner = flood[1:-1, 1:-1]
    holes = inner == 255

    filled = binary.copy()
    filled[holes] = 255
    return filled

def run_pipeline_center_region_growing(
    image,
    pipeline_name='Pipeline: Grayscale -> Canny -> Closing -> Region Growing (center) -> Canny(region) -> HoughLinesP -> HoughLines',
    rectangle_angle_tolerance_deg=5.0,
    rectangle_min_coverage_ratio=0.30,
):
    steps = {'Original': image.copy()}
    timings = {'Original': 0.0}

    start = time.perf_counter()
    blurred = cv2.GaussianBlur(image, (5, 5), 0)
    timings['Gaussian Blur'] = (time.perf_counter() - start) * 100
    steps['Gaussian Blur'] = blurred


    start = time.perf_counter()
    gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    timings['Grayscale'] = (time.perf_counter() - start) * 1000
    steps['Grayscale'] = gray

    start = time.perf_counter()
    canny = cv2.Canny(gray, 50, 150)
    timings['Canny'] = (time.perf_counter() - start) * 1000
    steps['Canny'] = canny

    start = time.perf_counter()
    canny_closed = cv2.morphologyEx(
        canny,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), np.uint8),
        iterations=2,
    )
    timings['Canny Closed'] = (time.perf_counter() - start) * 1000
    steps['Canny Closed'] = canny_closed

    start = time.perf_counter()
    inv = cv2.bitwise_not(canny_closed)
    flood = inv.copy()
    h, w = flood.shape
    center_seed = (w // 2, h // 2)
    flood_mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    cv2.floodFill(flood, flood_mask, center_seed, 128)
    region = np.where(flood == 128, 255, 0).astype(np.uint8)
    timings['Region Growing (Center)'] = (time.perf_counter() - start) * 1000
    steps['Region Growing (Center)'] = region

    start = time.perf_counter()
    region_filled = fill_holes_not_connected_to_edges(region)
    timings['Region Filled Holes'] = (time.perf_counter() - start) * 1000
    steps['Region Filled Holes'] = region_filled

    start = time.perf_counter()
    region_canny = cv2.Canny(region_filled, 50, 150)
    timings['Region Canny'] = (time.perf_counter() - start) * 1000
    steps['Region Canny'] = region_canny

    start = time.perf_counter()
    hough_lines_p_vis = cv2.cvtColor(region_filled, cv2.COLOR_GRAY2BGR)
    lines_p = cv2.HoughLinesP(
        region_canny,
        rho=0.5,
        theta=np.pi / 180,
        threshold=20,
        minLineLength=20,
        maxLineGap=10,
    )
    rectangle_lines, rectangle_clusters = filter_hough_lines_for_rectangle(
        lines_p,
        angle_tolerance_deg=rectangle_angle_tolerance_deg,
        min_coverage_ratio=rectangle_min_coverage_ratio,
        image_shape=region_filled.shape,
    )
    print(f"Detected {len(lines_p) if lines_p is not None else 0} HoughLinesP segments, "
          f"filtered down to {len(rectangle_lines)} rectangle-like segments in {len(rectangle_clusters)} clusters")
    if rectangle_lines:
        for x1, y1, x2, y2 in rectangle_lines:
            cv2.line(hough_lines_p_vis, (x1, y1), (x2, y2), (0, 255, 0), 2)
    timings['HoughLinesP (Region Canny)'] = (time.perf_counter() - start) * 1000
    steps['HoughLinesP (Region Canny)'] = hough_lines_p_vis

    start = time.perf_counter()
    clusters_vis = draw_clusters(cv2.cvtColor(region_filled, cv2.COLOR_GRAY2BGR), rectangle_clusters)
    timings['Rectangle Clusters'] = (time.perf_counter() - start) * 1000
    steps['Rectangle Clusters'] = clusters_vis

    start = time.perf_counter()
    quadrilateral_candidates = estimate_quadrilateral_candidates_from_clusters(
        rectangle_clusters,
        image_shape=region_filled.shape,
    )
    corners = quadrilateral_candidates.get('best')

    candidates_vis = draw_quadrilateral_candidates(
        cv2.cvtColor(region_filled, cv2.COLOR_GRAY2BGR),
        quadrilateral_candidates,
    )
    timings['Quadrilateral Candidates'] = (time.perf_counter() - start) * 1000
    steps['Quadrilateral Candidates'] = candidates_vis

    start = time.perf_counter()
    quadrilateral_vis = draw_quadrilateral_and_corners(
        cv2.cvtColor(region_filled, cv2.COLOR_GRAY2BGR),
        corners,
    )
    timings['Quadrilateral + 4 Corners'] = (time.perf_counter() - start) * 1000
    steps['Quadrilateral + 4 Corners'] = quadrilateral_vis

    start = time.perf_counter()
    inside_rectangle_only = mask_image_inside_quadrilateral(region_filled, corners)
    timings['Inside Rectangle Only'] = (time.perf_counter() - start) * 1000
    steps['Inside Rectangle Only'] = inside_rectangle_only

    start = time.perf_counter()
    inside_rectangle_mask = np.where(inside_rectangle_only > 0, 255, 0).astype(np.uint8)
    timings['Inside Rectangle Mask'] = (time.perf_counter() - start) * 1000
    steps['Inside Rectangle Mask'] = inside_rectangle_mask

    return {
        'name': pipeline_name,
        'steps': steps,
        'timings': timings,
        'corners': corners,
        'mask': inside_rectangle_mask,
    }


def build_pipeline_center_region_growing(image):
    return run_pipeline_center_region_growing(image)


PIPELINE_BUILDERS = [
    build_pipeline_center_region_growing,
]


def run_all_pipelines(image, pipeline_builders=None):
    builders = pipeline_builders if pipeline_builders is not None else PIPELINE_BUILDERS
    return [builder(image) for builder in builders]


def detect_rectangle_corners_and_mask(image):
    pipeline = run_pipeline_center_region_growing(image)
    return pipeline.get('corners'), pipeline.get('mask')


def process_detected_images(detected_dir='detected', res_dir='res'):
    detected_dir = Path(detected_dir)
    res_dir = Path(res_dir)

    image_extensions = {'.png', '.jpg', '.jpeg', '.bmp', '.tiff'}
    image_files = sorted([f for f in detected_dir.glob('*') if f.suffix.lower() in image_extensions])

    print(f"Found {len(image_files)} images in '{detected_dir}' directory")
    print("Files:", [f.name for f in image_files[:5]], "..." if len(image_files) > 5 else "")

    res_dir.mkdir(parents=True, exist_ok=True)

    results = []

    for image_file in image_files:
        image = cv2.imread(str(image_file))
        if image is None:
            print(f"Failed to load {image_file}")
            continue

        pipelines = run_all_pipelines(image)

        n_rows = len(pipelines)
        max_steps = max(len(p['steps']) for p in pipelines)

        fig, axes = plt.subplots(n_rows, max_steps, figsize=(6 * max_steps, 4.8 * n_rows), squeeze=False)

        for row_idx, pipeline in enumerate(pipelines):
            step_items = list(pipeline['steps'].items())
            timings = pipeline['timings']
            cumulative_ms = 0.0

            for col_idx in range(max_steps):
                ax = axes[row_idx, col_idx]

                if col_idx >= len(step_items):
                    ax.axis('off')
                    continue

                step_name, img = step_items[col_idx]

                if len(img.shape) == 3:
                    img_display = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                else:
                    img_display = img

                step_time = float(timings.get(step_name, 0.0))
                cumulative_ms += step_time

                ax.imshow(img_display, cmap='gray' if len(img.shape) == 2 else None)
                ax.set_title(
                    f"{step_name}\nstep: {step_time:.2f} ms\ncum: {cumulative_ms:.2f} ms",
                    fontsize=10,
                    fontweight='bold'
                )
                ax.axis('off')

                if col_idx == 0:
                    ax.set_ylabel(pipeline['name'], fontsize=11, fontweight='bold', rotation=90)

        fig.subplots_adjust(top=0.88, hspace=0.35)
        fig.suptitle(f'Image: {image_file.name}', fontsize=16, fontweight='bold', y=0.97)

        output_path = res_dir / image_file.name
        fig.savefig(output_path, dpi=180, bbox_inches='tight')

        totals = [sum(p['timings'].values()) for p in pipelines]
        totals_text = ', '.join([f"P{idx + 1}: {t:.2f} ms" for idx, t in enumerate(totals)])
        print(f"Processed: {image_file.name} | {totals_text} | Saved: {output_path}")

        primary_pipeline = pipelines[0] if pipelines else None
        corners = primary_pipeline.get('corners') if primary_pipeline is not None else None
        mask = primary_pipeline.get('mask') if primary_pipeline is not None else None

        results.append(
            {
                'image_file': str(image_file),
                'result_image': str(output_path),
                'corners': corners,
                'mask': mask,
            }
        )

    return results



if __name__ == "__main__":
    process_detected_images('detected', 'res')



