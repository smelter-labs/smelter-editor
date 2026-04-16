import cv2
import os
from ultralytics import YOLO

# Load the YOLOv8 model (nano version for speed)
model = YOLO('best.pt')

# Create detected directory if it doesn't exist
detected_dir = "detected"
os.makedirs(detected_dir, exist_ok=True)

# Start capturing video
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Webcam could not be opened.")
    exit()

# Set higher resolution
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

# Track saved detections and counter
previous_boxes = []
saved_count = 0
MAX_SAVED = 100
POSITION_THRESHOLD = 50  # pixels - boxes closer than this are considered duplicates

def is_duplicate_position(current_box, previous_boxes, threshold=POSITION_THRESHOLD):
    """Check if current box is roughly in the same place as a previous box"""
    x1, y1, x2, y2 = current_box
    current_center_x = (x1 + x2) / 2
    current_center_y = (y1 + y2) / 2
    
    for prev_x1, prev_y1, prev_x2, prev_y2 in previous_boxes:
        prev_center_x = (prev_x1 + prev_x2) / 2
        prev_center_y = (prev_y1 + prev_y2) / 2
        
        distance = ((current_center_x - prev_center_x) ** 2 + 
                   (current_center_y - prev_center_y) ** 2) ** 0.5
        
        if distance < threshold:
            return True
    
    return False

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Run inference with stream=True for better performance on video
    results = model(frame, stream=True)

    # Draw bounding boxes manually for each result
    for r in results:
        for box in r.boxes: 
            # if model.names[int(box.cls[0])] != "tv":
            #     continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])      # Box coordinates
            conf = float(box.conf[0])                   # Confidence
            cls = int(box.cls[0])                       # Class ID
            label = f"{model.names[cls]} {conf:.2f}"    # Class label

            if conf > 0:  # Only show if confidence > 50%
                # Check if not a duplicate and we haven't reached the limit
                if not is_duplicate_position((x1, y1, x2, y2), previous_boxes) and saved_count < MAX_SAVED:
                    # Crop the box contents
                    cropped = frame[y1:y2, x1:x2]
                    
                    # Save the cropped image
                    filename = os.path.join(detected_dir, f"screen_{saved_count:03d}.png")
                    cv2.imwrite(filename, cropped)
                    print(f"Saved {filename} (Count: {saved_count + 1}/{MAX_SAVED})")
                    
                    # Track this box
                    previous_boxes.append((x1, y1, x2, y2))
                    saved_count += 1
                    
                    # Stop if we've saved enough
                    if saved_count >= MAX_SAVED:
                        print(f"Reached {MAX_SAVED} saved images. Stopping...")
                        break
                
                # Bold red rectangles
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 4)

                # Bold red label
                cv2.putText(frame, label, (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 3)

    # Show the output
    cv2.imshow("YOLOv8 Detection", frame)

    # Exit on pressing 'q' or if we've saved enough images
    if (cv2.waitKey(1) & 0xFF == ord('q')) or (saved_count >= MAX_SAVED):
        break

cap.release()
cv2.destroyAllWindows()
print(f"Done! Saved {saved_count} images to '{detected_dir}' directory.")