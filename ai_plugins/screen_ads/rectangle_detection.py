import cv2
import numpy as np


def _line_angle_degrees(x1, y1, x2, y2):
    """Return a direction-independent line angle in the range [0, 180)."""
    angle = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180.0
    return float(angle)


def _angle_distance_degrees(angle_a, angle_b):
    """Smallest distance between two angles on a 180-degree circle."""
    diff = abs(angle_a - angle_b) % 180.0
    return min(diff, 180.0 - diff)


def _weighted_mean_angle_degrees(angles, weights):
    """Compute a weighted mean for angles with 180-degree periodicity."""
    if not angles:
        return 0.0

    doubled = np.deg2rad(np.asarray(angles, dtype=np.float64) * 2.0)
    weights = np.asarray(weights, dtype=np.float64)
    sin_sum = np.sum(np.sin(doubled) * weights)
    cos_sum = np.sum(np.cos(doubled) * weights)
    mean = 0.5 * np.degrees(np.arctan2(sin_sum, cos_sum))
    return float(mean % 180.0)


def _normal_from_angle_degrees(angle):
    theta = np.deg2rad(angle)
    normal = np.array([-np.sin(theta), np.cos(theta)], dtype=np.float64)
    if normal[1] < 0 or (abs(normal[1]) < 1e-9 and normal[0] < 0):
        normal = -normal
    return normal


def _weighted_offset_along_normal(midpoints, weights, normal):
    if not midpoints:
        return 0.0

    points = np.asarray(midpoints, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    offsets = points @ normal
    return float(np.sum(offsets * weights) / np.sum(weights))


def _estimate_coverage_ratio(segments, image_shape):
    """Estimate how much of the image is covered by the selected line cluster."""
    if image_shape is None or not segments:
        return None

    height, width = image_shape[:2]
    if height <= 0 or width <= 0:
        return None

    points = []
    for segment in segments:
        x1, y1, x2, y2 = segment['line']
        points.append([x1, y1])
        points.append([x2, y2])

    if len(points) < 3:
        return 0.0

    hull = cv2.convexHull(np.asarray(points, dtype=np.float32))
    if hull is None or len(hull) < 3:
        return 0.0

    area = float(cv2.contourArea(hull))
    return area / float(width * height)


def _collect_cluster_points(clusters):
    points = []
    for cluster in clusters:
        for segment in cluster['segments']:
            x1, y1, x2, y2 = segment['line']
            points.append([x1, y1])
            points.append([x2, y2])
    return points


def _order_quad_points(points):
    pts = np.asarray(points, dtype=np.float32)
    if pts.shape != (4, 2):
        return None

    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)

    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(s)]
    ordered[2] = pts[np.argmax(s)]
    ordered[1] = pts[np.argmin(d)]
    ordered[3] = pts[np.argmax(d)]
    return ordered


def _flatten_segments(clusters):
    segments = []
    for cluster in clusters:
        segments.extend(cluster['segments'])
    return segments


def _segment_points_and_midpoint(segment):
    x1, y1, x2, y2 = segment['line']
    p1 = np.array([x1, y1], dtype=np.float64)
    p2 = np.array([x2, y2], dtype=np.float64)
    midpoint = 0.5 * (p1 + p2)
    return p1, p2, midpoint


def _fit_line_to_segments(segments):
    points = []
    for segment in segments:
        x1, y1, x2, y2 = segment['line']
        points.append([x1, y1])
        points.append([x2, y2])

    if len(points) < 2:
        return None

    points_np = np.asarray(points, dtype=np.float32)
    vx, vy, x0, y0 = cv2.fitLine(points_np, cv2.DIST_L2, 0, 0.01, 0.01).reshape(-1)

    direction = np.array([vx, vy], dtype=np.float64)
    norm = np.linalg.norm(direction)
    if norm <= 1e-9:
        return None

    direction /= norm
    angle = np.degrees(np.arctan2(direction[1], direction[0])) % 180.0
    return {
        'point': np.array([x0, y0], dtype=np.float64),
        'direction': direction,
        'angle': float(angle),
    }


def _make_line_from_point_angle(point, angle_deg):
    theta = np.deg2rad(angle_deg)
    direction = np.array([np.cos(theta), np.sin(theta)], dtype=np.float64)
    return {
        'point': np.asarray(point, dtype=np.float64),
        'direction': direction,
        'angle': float(angle_deg % 180.0),
    }


def _signed_line_angle_delta(angle, reference_angle):
    return ((angle - reference_angle + 90.0) % 180.0) - 90.0


def _line_intersection(line_a, line_b):
    p = line_a['point']
    r = line_a['direction']
    q = line_b['point']
    s = line_b['direction']

    denom = r[0] * s[1] - r[1] * s[0]
    if abs(denom) <= 1e-8:
        return None

    qp = q - p
    t = (qp[0] * s[1] - qp[1] * s[0]) / denom
    return p + t * r


def _line_from_normal_and_offset(normal, offset):
    normal = np.asarray(normal, dtype=np.float64)
    norm = np.linalg.norm(normal)
    if norm <= 1e-9:
        return None
    normal = normal / norm
    direction = np.array([normal[1], -normal[0]], dtype=np.float64)
    point = normal * float(offset)
    angle = np.degrees(np.arctan2(direction[1], direction[0])) % 180.0
    return {
        'point': point,
        'direction': direction,
        'angle': float(angle),
    }


def _fit_line_to_points(points):
    points = np.asarray(points, dtype=np.float32)
    if len(points) < 2:
        return None

    vx, vy, x0, y0 = cv2.fitLine(points, cv2.DIST_L2, 0, 0.01, 0.01).reshape(-1)
    direction = np.array([vx, vy], dtype=np.float64)
    norm = np.linalg.norm(direction)
    if norm <= 1e-9:
        return None

    direction /= norm
    angle = np.degrees(np.arctan2(direction[1], direction[0])) % 180.0
    return {
        'point': np.array([x0, y0], dtype=np.float64),
        'direction': direction,
        'angle': float(angle),
    }


def _split_segments_into_two_offset_groups(segments, normal):
    if not segments:
        return None, None

    projections = []
    lengths = []
    for segment in segments:
        _, _, midpoint = _segment_points_and_midpoint(segment)
        projections.append(float(np.dot(midpoint, normal)))
        lengths.append(float(segment.get('length', 1.0)))

    projections = np.asarray(projections, dtype=np.float64)
    lengths = np.asarray(lengths, dtype=np.float64)

    if len(projections) < 2:
        return None, None

    center_a = float(np.min(projections))
    center_b = float(np.max(projections))
    if abs(center_b - center_a) <= 1e-6:
        return None, None

    assignments = np.zeros(len(projections), dtype=np.int32)
    for _ in range(20):
        dist_a = np.abs(projections - center_a)
        dist_b = np.abs(projections - center_b)
        new_assignments = (dist_b < dist_a).astype(np.int32)

        if np.array_equal(new_assignments, assignments):
            break
        assignments = new_assignments

        if np.any(assignments == 0):
            w0 = lengths[assignments == 0]
            p0 = projections[assignments == 0]
            center_a = float(np.sum(w0 * p0) / np.sum(w0))
        if np.any(assignments == 1):
            w1 = lengths[assignments == 1]
            p1 = projections[assignments == 1]
            center_b = float(np.sum(w1 * p1) / np.sum(w1))

    if not np.any(assignments == 0) or not np.any(assignments == 1):
        return None, None

    group_0 = [segments[i] for i in range(len(segments)) if assignments[i] == 0]
    group_1 = [segments[i] for i in range(len(segments)) if assignments[i] == 1]

    mean_0 = float(np.mean([projections[i] for i in range(len(segments)) if assignments[i] == 0]))
    mean_1 = float(np.mean([projections[i] for i in range(len(segments)) if assignments[i] == 1]))

    if mean_0 <= mean_1:
        return group_0, group_1
    return group_1, group_0


def _is_valid_quad(corners, image_shape=None):
    if corners is None:
        return False

    corners = np.asarray(corners, dtype=np.float64)
    if corners.shape != (4, 2) or not np.all(np.isfinite(corners)):
        return False

    pairwise_min = np.inf
    for i in range(4):
        for j in range(i + 1, 4):
            pairwise_min = min(pairwise_min, np.linalg.norm(corners[i] - corners[j]))
    if pairwise_min < 5.0:
        return False

    area = abs(float(cv2.contourArea(corners.astype(np.float32))))
    if area < 100.0:
        return False

    if image_shape is not None:
        height, width = image_shape[:2]
        margin = 0.2 * max(width, height)
        xs = corners[:, 0]
        ys = corners[:, 1]
        if np.any(xs < -margin) or np.any(xs > (width - 1 + margin)):
            return False
        if np.any(ys < -margin) or np.any(ys > (height - 1 + margin)):
            return False

    return True


def _quad_edge_angles(corners):
    corners = np.asarray(corners, dtype=np.float64)
    if corners.shape != (4, 2):
        return None

    def angle(i, j):
        x1, y1 = corners[i]
        x2, y2 = corners[j]
        return _line_angle_degrees(x1, y1, x2, y2)

    return {
        'top': angle(0, 1),
        'right': angle(1, 2),
        'bottom': angle(3, 2),
        'left': angle(0, 3),
    }


def _quad_alignment_score(corners, family_angle_a, family_angle_b):
    edge_angles = _quad_edge_angles(corners)
    if edge_angles is None:
        return np.inf

    top = edge_angles['top']
    right = edge_angles['right']
    bottom = edge_angles['bottom']
    left = edge_angles['left']

    score_assign_a_top = (
        _angle_distance_degrees(top, family_angle_a)
        + _angle_distance_degrees(bottom, family_angle_a)
        + _angle_distance_degrees(left, family_angle_b)
        + _angle_distance_degrees(right, family_angle_b)
    )

    score_assign_b_top = (
        _angle_distance_degrees(top, family_angle_b)
        + _angle_distance_degrees(bottom, family_angle_b)
        + _angle_distance_degrees(left, family_angle_a)
        + _angle_distance_degrees(right, family_angle_a)
    )

    return float(min(score_assign_a_top, score_assign_b_top))


def _line_from_segment_points(p1, p2):
    p1 = np.asarray(p1, dtype=np.float64)
    p2 = np.asarray(p2, dtype=np.float64)
    direction = p2 - p1
    norm = np.linalg.norm(direction)
    if norm <= 1e-9:
        return None
    direction /= norm
    angle = np.degrees(np.arctan2(direction[1], direction[0])) % 180.0
    return {
        'point': p1,
        'direction': direction,
        'angle': float(angle),
    }


def _point_line_distance(point, line):
    point = np.asarray(point, dtype=np.float64)
    p0 = line['point']
    d = line['direction']
    perp = np.array([-d[1], d[0]], dtype=np.float64)
    return abs(float(np.dot(point - p0, perp)))


def _mirror_penalty_degrees(corners, family_angle_a, family_angle_b):
    edge_angles = _quad_edge_angles(corners)
    if edge_angles is None:
        return np.inf

    top = edge_angles['top']
    right = edge_angles['right']
    bottom = edge_angles['bottom']
    left = edge_angles['left']

    def pair_penalty(a1, a2):
        center = _weighted_mean_angle_degrees([a1, a2], [1.0, 1.0])
        d1 = _signed_line_angle_delta(a1, center)
        d2 = _signed_line_angle_delta(a2, center)
        return abs(abs(d1) - abs(d2))

    mirror_tb = pair_penalty(top, bottom)
    mirror_lr = pair_penalty(left, right)

    assign_a_top = (
        _angle_distance_degrees(top, family_angle_a)
        + _angle_distance_degrees(bottom, family_angle_a)
        + _angle_distance_degrees(left, family_angle_b)
        + _angle_distance_degrees(right, family_angle_b)
    )
    assign_b_top = (
        _angle_distance_degrees(top, family_angle_b)
        + _angle_distance_degrees(bottom, family_angle_b)
        + _angle_distance_degrees(left, family_angle_a)
        + _angle_distance_degrees(right, family_angle_a)
    )

    alignment = min(assign_a_top, assign_b_top)
    return float(alignment + 2.0 * (mirror_tb + mirror_lr))


def _quad_support_distance_score(corners, family_a_segments, family_b_segments, family_angle_a, family_angle_b):
    corners = np.asarray(corners, dtype=np.float64)
    if corners.shape != (4, 2):
        return np.inf

    edge_top = _line_from_segment_points(corners[0], corners[1])
    edge_right = _line_from_segment_points(corners[1], corners[2])
    edge_bottom = _line_from_segment_points(corners[3], corners[2])
    edge_left = _line_from_segment_points(corners[0], corners[3])
    if any(line is None for line in (edge_top, edge_right, edge_bottom, edge_left)):
        return np.inf

    assign_a_top = (
        _angle_distance_degrees(edge_top['angle'], family_angle_a)
        + _angle_distance_degrees(edge_bottom['angle'], family_angle_a)
        + _angle_distance_degrees(edge_left['angle'], family_angle_b)
        + _angle_distance_degrees(edge_right['angle'], family_angle_b)
    ) <= (
        _angle_distance_degrees(edge_top['angle'], family_angle_b)
        + _angle_distance_degrees(edge_bottom['angle'], family_angle_b)
        + _angle_distance_degrees(edge_left['angle'], family_angle_a)
        + _angle_distance_degrees(edge_right['angle'], family_angle_a)
    )

    if assign_a_top:
        top_segments = family_a_segments
        side_segments = family_b_segments
    else:
        top_segments = family_b_segments
        side_segments = family_a_segments

    def weighted_mean_distance(segments, line_1, line_2):
        if not segments:
            return np.inf
        d_sum = 0.0
        w_sum = 0.0
        for segment in segments:
            _, _, midpoint = _segment_points_and_midpoint(segment)
            distance = min(_point_line_distance(midpoint, line_1), _point_line_distance(midpoint, line_2))
            weight = float(segment.get('length', 1.0))
            d_sum += distance * weight
            w_sum += weight
        return d_sum / max(w_sum, 1e-9)

    dist_top_family = weighted_mean_distance(top_segments, edge_top, edge_bottom)
    dist_side_family = weighted_mean_distance(side_segments, edge_left, edge_right)
    return float(dist_top_family + dist_side_family)


def _clip_corners_to_image(corners, image_shape):
    if corners is None or image_shape is None:
        return corners

    height, width = image_shape[:2]
    clipped = np.asarray(corners, dtype=np.float32).copy()
    clipped[:, 0] = np.clip(clipped[:, 0], 0, width - 1)
    clipped[:, 1] = np.clip(clipped[:, 1], 0, height - 1)
    return clipped


def _select_best_quad_candidate(
    candidates,
    family_angle_a,
    family_angle_b,
    family_a_segments,
    family_b_segments,
    image_shape=None,
):
    best = None
    best_score = np.inf

    for candidate in candidates:
        if candidate is None:
            continue

        candidate = np.asarray(candidate, dtype=np.float32)
        candidate = _order_quad_points(candidate)
        if candidate is None:
            continue

        candidate = _clip_corners_to_image(candidate, image_shape)
        if not _is_valid_quad(candidate, image_shape=image_shape):
            continue

        mirror_score = _mirror_penalty_degrees(candidate, family_angle_a, family_angle_b)
        support_score = _quad_support_distance_score(
            candidate,
            family_a_segments,
            family_b_segments,
            family_angle_a,
            family_angle_b,
        )
        score = mirror_score + 0.35 * support_score
        if score < best_score:
            best_score = score
            best = candidate

    return best


def _estimate_quadrilateral_from_clusters_envelope(clusters, image_shape=None):
    if not clusters:
        return None

    all_segments = _flatten_segments(clusters)
    if len(all_segments) < 2:
        return None

    dominant_angle = float(clusters[0]['angle'])
    orthogonal_angle = (dominant_angle + 90.0) % 180.0

    family_a = []
    family_b = []
    for segment in all_segments:
        angle = segment['angle']
        if _angle_distance_degrees(angle, dominant_angle) <= _angle_distance_degrees(angle, orthogonal_angle):
            family_a.append(segment)
        else:
            family_b.append(segment)

    if not family_a:
        family_a = all_segments
    if not family_b:
        family_b = all_segments

    def collect_points(segments):
        points = []
        for segment in segments:
            x1, y1, x2, y2 = segment['line']
            points.append([x1, y1])
            points.append([x2, y2])
        return np.asarray(points, dtype=np.float64)

    points_a = collect_points(family_a)
    points_b = collect_points(family_b)
    if len(points_a) < 2 or len(points_b) < 2:
        return None

    angle_a = _weighted_mean_angle_degrees(
        [segment['angle'] for segment in family_a],
        [segment['length'] for segment in family_a],
    )
    angle_b = _weighted_mean_angle_degrees(
        [segment['angle'] for segment in family_b],
        [segment['length'] for segment in family_b],
    )

    theta_a = np.deg2rad(angle_a)
    normal_a = np.array([-np.sin(theta_a), np.cos(theta_a)], dtype=np.float64)
    theta_b = np.deg2rad(angle_b)
    normal_b = np.array([-np.sin(theta_b), np.cos(theta_b)], dtype=np.float64)

    group_a_neg, group_a_pos = _split_segments_into_two_offset_groups(family_a, normal_a)
    group_b_neg, group_b_pos = _split_segments_into_two_offset_groups(family_b, normal_b)

    line_a_neg = _fit_line_to_points(collect_points(group_a_neg)) if group_a_neg else None
    line_a_pos = _fit_line_to_points(collect_points(group_a_pos)) if group_a_pos else None
    line_b_neg = _fit_line_to_points(collect_points(group_b_neg)) if group_b_neg else None
    line_b_pos = _fit_line_to_points(collect_points(group_b_pos)) if group_b_pos else None

    if any(line is None for line in (line_a_neg, line_a_pos, line_b_neg, line_b_pos)):
        proj_a = points_a @ normal_a
        proj_b = points_b @ normal_b

        low_q, high_q = 0.02, 0.98
        a_min = float(np.quantile(proj_a, low_q))
        a_max = float(np.quantile(proj_a, high_q))
        b_min = float(np.quantile(proj_b, low_q))
        b_max = float(np.quantile(proj_b, high_q))

        if abs(a_max - a_min) <= 1e-6 or abs(b_max - b_min) <= 1e-6:
            return None

        band_a = max(2.0, 0.08 * (a_max - a_min))
        band_b = max(2.0, 0.08 * (b_max - b_min))

        points_a_neg = points_a[proj_a <= (a_min + band_a)]
        points_a_pos = points_a[proj_a >= (a_max - band_a)]
        points_b_neg = points_b[proj_b <= (b_min + band_b)]
        points_b_pos = points_b[proj_b >= (b_max - band_b)]

        if line_a_neg is None:
            line_a_neg = _fit_line_to_points(points_a_neg)
        if line_a_pos is None:
            line_a_pos = _fit_line_to_points(points_a_pos)
        if line_b_neg is None:
            line_b_neg = _fit_line_to_points(points_b_neg)
        if line_b_pos is None:
            line_b_pos = _fit_line_to_points(points_b_pos)

        if line_a_neg is None:
            line_a_neg = _line_from_normal_and_offset(normal_a, a_min)
        if line_a_pos is None:
            line_a_pos = _line_from_normal_and_offset(normal_a, a_max)
        if line_b_neg is None:
            line_b_neg = _line_from_normal_and_offset(normal_b, b_min)
        if line_b_pos is None:
            line_b_pos = _line_from_normal_and_offset(normal_b, b_max)

    if any(line is None for line in (line_a_neg, line_a_pos, line_b_neg, line_b_pos)):
        return None

    intersections = [
        _line_intersection(line_a_neg, line_b_neg),
        _line_intersection(line_a_pos, line_b_neg),
        _line_intersection(line_a_pos, line_b_pos),
        _line_intersection(line_a_neg, line_b_pos),
    ]
    if any(point is None for point in intersections):
        return None

    corners = _order_quad_points(np.asarray(intersections, dtype=np.float32))
    if corners is None:
        return None

    if image_shape is not None:
        height, width = image_shape[:2]
        corners[:, 0] = np.clip(corners[:, 0], 0, width - 1)
        corners[:, 1] = np.clip(corners[:, 1], 0, height - 1)

    return corners


def _estimate_quadrilateral_from_cluster_pairs(clusters, image_shape=None):
    if len(clusters) < 4:
        return None  # Need at least 4 clusters for meaningful 2-2 pairing

    def try_cluster_pair(dominant_idx):
        """Try to form quadrilateral using cluster at dominant_idx as reference."""
        dominant_angle = float(clusters[dominant_idx]['angle'])
        orthogonal_angle = (dominant_angle + 90.0) % 180.0

        family_a = []
        family_b = []
        for cluster in clusters:
            angle = float(cluster['angle'])
            if _angle_distance_degrees(angle, dominant_angle) <= _angle_distance_degrees(angle, orthogonal_angle):
                family_a.append(cluster)
            else:
                family_b.append(cluster)

        # Require at least 2 distinct clusters per family
        if len(family_a) < 2 or len(family_b) < 2:
            return None

        family_a = sorted(family_a, key=lambda c: c['length_sum'], reverse=True)[:2]
        family_b = sorted(family_b, key=lambda c: c['length_sum'], reverse=True)[:2]

        def fit_cluster_line(cluster):
            points = []
            for segment in cluster['segments']:
                x1, y1, x2, y2 = segment['line']
                points.append([x1, y1])
                points.append([x2, y2])
            return _fit_line_to_points(points)

        lines_a = [fit_cluster_line(cluster) for cluster in family_a]
        lines_b = [fit_cluster_line(cluster) for cluster in family_b]
        if any(line is None for line in lines_a + lines_b):
            return None

        normal_a = _normal_from_angle_degrees(_weighted_mean_angle_degrees([line['angle'] for line in lines_a], [1.0, 1.0]))
        normal_b = _normal_from_angle_degrees(_weighted_mean_angle_degrees([line['angle'] for line in lines_b], [1.0, 1.0]))

        offsets_a = [float(np.dot(line['point'], normal_a)) for line in lines_a]
        offsets_b = [float(np.dot(line['point'], normal_b)) for line in lines_b]

        line_a_neg, line_a_pos = (lines_a[0], lines_a[1]) if offsets_a[0] <= offsets_a[1] else (lines_a[1], lines_a[0])
        line_b_neg, line_b_pos = (lines_b[0], lines_b[1]) if offsets_b[0] <= offsets_b[1] else (lines_b[1], lines_b[0])

        intersections = [
            _line_intersection(line_a_neg, line_b_neg),
            _line_intersection(line_a_pos, line_b_neg),
            _line_intersection(line_a_pos, line_b_pos),
            _line_intersection(line_a_neg, line_b_pos),
        ]
        if any(point is None for point in intersections):
            return None

        corners = _order_quad_points(np.asarray(intersections, dtype=np.float32))
        return _clip_corners_to_image(corners, image_shape)

    # Try with each cluster as dominant angle reference, prefer largest clusters first
    sorted_indices = sorted(range(len(clusters)), key=lambda i: clusters[i]['length_sum'], reverse=True)
    for idx in sorted_indices:
        result = try_cluster_pair(idx)
        if result is not None:
            return result

    return None


def _build_side_lines_for_family(segments, reference_angle, center_point, all_points=None):
    if not segments:
        return None

    theta = np.deg2rad(reference_angle)
    normal = np.array([-np.sin(theta), np.cos(theta)], dtype=np.float64)

    side_negative = []
    side_positive = []
    for segment in segments:
        _, _, midpoint = _segment_points_and_midpoint(segment)
        signed_offset = float(np.dot(midpoint - center_point, normal))
        if signed_offset < 0:
            side_negative.append(segment)
        else:
            side_positive.append(segment)

    if not side_negative or not side_positive:
        if all_points is None or len(all_points) < 4:
            return None

        points_np = np.asarray(all_points, dtype=np.float64)
        centered = points_np - center_point.reshape(1, 2)
        offsets = centered @ normal
        min_offset = float(np.min(offsets))
        max_offset = float(np.max(offsets))

        if abs(max_offset - min_offset) <= 1e-6:
            return None

        point_negative = center_point + min_offset * normal
        point_positive = center_point + max_offset * normal

        line_negative = _make_line_from_point_angle(point_negative, reference_angle)
        line_positive = _make_line_from_point_angle(point_positive, reference_angle)
        return line_negative, line_positive

    line_negative = _fit_line_to_segments(side_negative)
    line_positive = _fit_line_to_segments(side_positive)
    if line_negative is None or line_positive is None:
        return None

    center_angle = _weighted_mean_angle_degrees(
        [line_negative['angle'], line_positive['angle']],
        [len(side_negative), len(side_positive)],
    )

    delta_negative = _signed_line_angle_delta(line_negative['angle'], center_angle)
    delta_positive = _signed_line_angle_delta(line_positive['angle'], center_angle)
    mirrored_delta = 0.5 * (abs(delta_negative) + abs(delta_positive))

    target_negative = (center_angle - mirrored_delta) % 180.0
    target_positive = (center_angle + mirrored_delta) % 180.0

    line_negative = _make_line_from_point_angle(line_negative['point'], target_negative)
    line_positive = _make_line_from_point_angle(line_positive['point'], target_positive)
    return line_negative, line_positive


def _estimate_quadrilateral_from_points(points):
    if len(points) < 4:
        return None

    points_np = np.asarray(points, dtype=np.float32)
    hull = cv2.convexHull(points_np)
    if hull is None or len(hull) < 4:
        return None

    peri = cv2.arcLength(hull, True)
    approx = cv2.approxPolyDP(hull, 0.02 * peri, True)
    if approx is not None and len(approx) == 4:
        quad = approx.reshape(4, 2).astype(np.float32)
    else:
        rect = cv2.minAreaRect(points_np)
        quad = cv2.boxPoints(rect).astype(np.float32)

    return _order_quad_points(quad)


def _compute_quadrilateral_candidates_from_clusters(clusters, image_shape=None):
    """Estimate 4 corners from selected line clusters.

    Returns ordered corners as float32 points in TL, TR, BR, BL order.
    """
    if not clusters:
        return {
            'perspective': None,
            'envelope': None,
            'fallback': None,
            'best': None,
        }

    all_segments = _flatten_segments(clusters)
    if len(all_segments) < 4:
        return {
            'perspective': None,
            'envelope': None,
            'fallback': None,
            'best': None,
        }

    all_points = _collect_cluster_points(clusters)
    center_point = np.mean(np.asarray(all_points, dtype=np.float64), axis=0)

    dominant_angle = float(clusters[0]['angle'])
    family_a = []
    family_b = []
    orthogonal_angle = (dominant_angle + 90.0) % 180.0

    for segment in all_segments:
        angle = segment['angle']
        dist_a = _angle_distance_degrees(angle, dominant_angle)
        dist_b = _angle_distance_degrees(angle, orthogonal_angle)
        if dist_a <= dist_b:
            family_a.append(segment)
        else:
            family_b.append(segment)

    if not family_a or not family_b:
        corners = _estimate_quadrilateral_from_clusters_envelope(clusters, image_shape=image_shape)
        if _is_valid_quad(corners, image_shape=image_shape):
            return {
                'perspective': None,
                'envelope': _clip_corners_to_image(corners, image_shape),
                'fallback': _clip_corners_to_image(_estimate_quadrilateral_from_points(all_points), image_shape),
                'best': _clip_corners_to_image(corners, image_shape),
            }
        fallback = _estimate_quadrilateral_from_points(all_points)
        fallback = _clip_corners_to_image(fallback, image_shape)
        return {
            'perspective': None,
            'envelope': None,
            'fallback': fallback,
            'best': fallback,
        }

    family_gate_deg = 12.0
    family_a = [
        segment
        for segment in family_a
        if _angle_distance_degrees(segment['angle'], dominant_angle) <= family_gate_deg
    ]
    family_b = [
        segment
        for segment in family_b
        if _angle_distance_degrees(segment['angle'], orthogonal_angle) <= family_gate_deg
    ]

    if not family_a or not family_b:
        corners = _estimate_quadrilateral_from_clusters_envelope(clusters, image_shape=image_shape)
        if _is_valid_quad(corners, image_shape=image_shape):
            return {
                'perspective': None,
                'envelope': _clip_corners_to_image(corners, image_shape),
                'fallback': _clip_corners_to_image(_estimate_quadrilateral_from_points(all_points), image_shape),
                'best': _clip_corners_to_image(corners, image_shape),
            }
        fallback = _estimate_quadrilateral_from_points(all_points)
        fallback = _clip_corners_to_image(fallback, image_shape)
        return {
            'perspective': None,
            'envelope': None,
            'fallback': fallback,
            'best': fallback,
        }

    family_angle_a = _weighted_mean_angle_degrees(
        [segment['angle'] for segment in family_a],
        [segment['length'] for segment in family_a],
    )
    family_angle_b = _weighted_mean_angle_degrees(
        [segment['angle'] for segment in family_b],
        [segment['length'] for segment in family_b],
    )

    side_lines_a = _build_side_lines_for_family(
        family_a,
        dominant_angle,
        center_point,
        all_points=all_points,
    )
    side_lines_b = _build_side_lines_for_family(
        family_b,
        orthogonal_angle,
        center_point,
        all_points=all_points,
    )

    perspective_corners = None
    if side_lines_a is not None and side_lines_b is not None:
        line_a_neg, line_a_pos = side_lines_a
        line_b_neg, line_b_pos = side_lines_b

        intersections = [
            _line_intersection(line_a_neg, line_b_neg),
            _line_intersection(line_a_pos, line_b_neg),
            _line_intersection(line_a_pos, line_b_pos),
            _line_intersection(line_a_neg, line_b_pos),
        ]

        if all(point is not None for point in intersections):
            perspective_corners = np.asarray(intersections, dtype=np.float32)

    envelope_corners = _estimate_quadrilateral_from_clusters_envelope(clusters, image_shape=image_shape)
    cluster_pair_corners = _estimate_quadrilateral_from_cluster_pairs(clusters, image_shape=image_shape)
    fallback_corners = _estimate_quadrilateral_from_points(all_points)

    best = _select_best_quad_candidate(
        [perspective_corners, envelope_corners, cluster_pair_corners, fallback_corners],
        family_angle_a,
        family_angle_b,
        family_a,
        family_b,
        image_shape=image_shape,
    )

    perspective_corners = _clip_corners_to_image(_order_quad_points(perspective_corners), image_shape) if perspective_corners is not None else None
    envelope_corners = _clip_corners_to_image(_order_quad_points(envelope_corners), image_shape) if envelope_corners is not None else None
    cluster_pair_corners = _clip_corners_to_image(_order_quad_points(cluster_pair_corners), image_shape) if cluster_pair_corners is not None else None
    fallback_corners = _clip_corners_to_image(_order_quad_points(fallback_corners), image_shape) if fallback_corners is not None else None
    best = _clip_corners_to_image(best, image_shape) if best is not None else None

    if best is None:
        best = fallback_corners

    return {
        'perspective': perspective_corners,
        'envelope': envelope_corners,
        'cluster_pair': cluster_pair_corners,
        'fallback': fallback_corners,
        'best': best,
    }


def estimate_quadrilateral_corners_from_clusters(clusters, image_shape=None):
    """Estimate 4 corners from selected line clusters.

    Returns ordered corners as float32 points in TL, TR, BR, BL order.
    """
    candidates = _compute_quadrilateral_candidates_from_clusters(clusters, image_shape=image_shape)
    return candidates.get('best')


def estimate_quadrilateral_candidates_from_clusters(clusters, image_shape=None):
    """Return all quadrilateral candidates and the selected best candidate."""
    return _compute_quadrilateral_candidates_from_clusters(clusters, image_shape=image_shape)


def draw_clusters(image, clusters):
    """Draw each cluster in a distinct color on top of the given image."""
    vis = image.copy()
    if not clusters:
        return vis

    palette = [
        (255, 0, 0),
        (0, 255, 0),
        (0, 0, 255),
        (255, 255, 0),
        (255, 0, 255),
        (0, 255, 255),
    ]

    for idx, cluster in enumerate(clusters):
        color = palette[idx % len(palette)]
        for segment in cluster['segments']:
            x1, y1, x2, y2 = segment['line']
            cv2.line(vis, (x1, y1), (x2, y2), color, 2)

    return vis


def draw_quadrilateral_and_corners(image, corners):
    """Draw the quadrilateral and its 4 corners on a copy of image."""
    vis = image.copy()
    if corners is None:
        return vis

    quad = np.round(corners).astype(np.int32)
    cv2.polylines(vis, [quad.reshape(-1, 1, 2)], isClosed=True, color=(0, 255, 255), thickness=3)

    for idx, (x, y) in enumerate(quad):
        cv2.circle(vis, (int(x), int(y)), 6, (0, 0, 255), -1)
        cv2.putText(
            vis,
            str(idx + 1),
            (int(x) + 8, int(y) - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
        )

    return vis


def draw_quadrilateral_candidates(image, candidates):
    """Draw all quadrilateral candidates in different colors on a copy of image."""
    vis = image.copy()
    if not candidates:
        return vis

    palette = {
        'perspective': (255, 0, 255),
        'envelope': (0, 255, 255),
        'cluster_pair': (0, 128, 255),
        'fallback': (255, 128, 0),
        'best': (0, 255, 0),
    }

    for name in ['perspective', 'envelope', 'cluster_pair', 'fallback', 'best']:
        quad = candidates.get(name)
        if quad is None:
            continue

        quad_int = np.round(quad).astype(np.int32)
        color = palette.get(name, (255, 255, 255))
        thickness = 3 if name == 'best' else 2
        cv2.polylines(vis, [quad_int.reshape(-1, 1, 2)], isClosed=True, color=color, thickness=thickness)

    return vis


def mask_image_inside_quadrilateral(image, corners):
    """Return image with only the quadrilateral interior preserved.

    Pixels outside the quadrilateral are set to black. No rectangle is drawn.
    """
    if corners is None:
        return np.zeros_like(image)

    quad = np.round(corners).astype(np.int32).reshape(-1, 1, 2)
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [quad], 255)
    return cv2.bitwise_and(image, image, mask=mask)


def filter_hough_lines_for_rectangle(
    lines_p,
    angle_tolerance_deg=5.0,
    min_coverage_ratio=0.30,
    max_clusters=4,
    image_shape=None,
    position_tolerance_ratio=0.12,
):
    """Keep only Hough line segments that belong to a large rectangle-like shape.

    The function groups segments by angle within ``angle_tolerance_deg`` and keeps
    the strongest angle clusters. It also rejects candidates whose estimated
    coverage is smaller than ``min_coverage_ratio`` of the image area.
    """
    if lines_p is None:
        return [], []

    segments = []
    for line in lines_p:
        x1, y1, x2, y2 = map(int, line[0])
        length = float(np.hypot(x2 - x1, y2 - y1))
        if length <= 0:
            continue
        midpoint = ((x1 + x2) * 0.5, (y1 + y2) * 0.5)
        segments.append(
            {
                'line': (x1, y1, x2, y2),
                'angle': _line_angle_degrees(x1, y1, x2, y2),
                'length': length,
                'midpoint': midpoint,
            }
        )

    if not segments:
        return [], []

    segments.sort(key=lambda item: item['length'], reverse=True)

    if image_shape is not None:
        height, width = image_shape[:2]
        position_tolerance_px = max(12.0, min(height, width) * position_tolerance_ratio)
    else:
        all_midpoints = np.asarray([segment['midpoint'] for segment in segments], dtype=np.float64)
        if len(all_midpoints) > 0:
            span = np.ptp(all_midpoints, axis=0)
            position_tolerance_px = max(12.0, min(span[0], span[1]) * position_tolerance_ratio)
        else:
            position_tolerance_px = 20.0

    clusters = []
    for segment in segments:
        assigned_cluster = None
        for cluster in clusters:
            if _angle_distance_degrees(segment['angle'], cluster['angle']) > angle_tolerance_deg:
                continue

            normal = _normal_from_angle_degrees(cluster['angle'])
            segment_offset = float(np.dot(np.asarray(segment['midpoint'], dtype=np.float64), normal))
            if abs(segment_offset - cluster['offset']) <= position_tolerance_px:
                assigned_cluster = cluster
                break

        if assigned_cluster is None:
            assigned_cluster = {
                'segments': [],
                'angles': [],
                'weights': [],
                'midpoints': [],
                'length_sum': 0.0,
                'angle': segment['angle'],
                'offset': 0.0,
            }
            clusters.append(assigned_cluster)

        assigned_cluster['segments'].append(segment)
        assigned_cluster['angles'].append(segment['angle'])
        assigned_cluster['weights'].append(segment['length'])
        assigned_cluster['midpoints'].append(segment['midpoint'])
        assigned_cluster['length_sum'] += segment['length']
        assigned_cluster['angle'] = _weighted_mean_angle_degrees(
            assigned_cluster['angles'],
            assigned_cluster['weights'],
        )
        assigned_cluster['offset'] = _weighted_offset_along_normal(
            assigned_cluster['midpoints'],
            assigned_cluster['weights'],
            _normal_from_angle_degrees(assigned_cluster['angle']),
        )

    clusters.sort(key=lambda cluster: cluster['length_sum'], reverse=True)

    if not clusters:
        return [], []

    strongest_length = clusters[0]['length_sum']
    strong_clusters = [
        cluster
        for cluster in clusters
        if cluster['length_sum'] >= strongest_length * 0.15 or len(cluster['segments']) >= 2
    ]

    if not strong_clusters:
        strong_clusters = clusters[:1]

    selected_clusters = strong_clusters[:max_clusters]

    selected_segments = [segment for cluster in selected_clusters for segment in cluster['segments']]
    coverage_ratio = _estimate_coverage_ratio(selected_segments, image_shape)
    if coverage_ratio is not None and coverage_ratio < min_coverage_ratio:
        return [], []

    selected_lines = [segment['line'] for segment in selected_segments]
    selected_lines.sort(key=lambda line: np.hypot(line[2] - line[0], line[3] - line[1]), reverse=True)

    return selected_lines, selected_clusters