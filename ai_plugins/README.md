# YOLO Search Server

A FastAPI-based HTTP server for running YOLO object detection on video streams. The server can process multiple detection tasks in parallel and send results via HTTP callbacks.

## Directory Structure

```
ai_plugins/
├── README.md                  # This file
├── yolo_server.py            # Main FastAPI server (entry point)
├── requirements_yolo.txt     # Python dependencies
├── .venv/                    # Python virtual environment (created during setup)
├── .python-version           # Python version specification
├── models/                   # 📁 Add your .pt model files here
│   └── (place your YOLOv8 .pt files here)
└── screen_ads/               # Default/fallback model location
    └── best.pt               # Default model (loads if no model in ./models/)
```

### Where to Put Files

- **Model files (.pt)**: Place YOLOv8 model files in the `models/` directory
  - Example: `ai_plugins/models/custom_model.pt`
  - If no model is found in `models/`, the server falls back to `screen_ads/best.pt`
  - Models are cached after first load for performance

- **Custom detection scripts**: Place any additional Python scripts in the `screen_ads/` directory

## Setup

### 1. Install Python Dependencies

Navigate to the `ai_plugins` directory and install the required packages:

```bash
cd ai_plugins
pip install -r requirements_yolo.txt
```

**Dependencies:**
- `fastapi` - Web framework
- `uvicorn[standard]` - ASGI server
- `ultralytics` - YOLOv8 models
- `opencv-python-headless` - Image processing
- `numpy` - Numerical operations
- `pillow` - Image handling
- `httpx` - HTTP client for callbacks

### 2. Add a Model

Place a YOLOv8 `.pt` model file in the `models/` directory:

```bash
# Example: copy a model file
cp path/to/your/model.pt models/
```

Or use the built-in default at `screen_ads/best.pt`.

## Running the Server

### Start the Uvicorn Server

From the `ai_plugins` directory, run:

```bash
uvicorn yolo_server:app --host 0.0.0.0 --port 8765
```

**Parameters:**
- `yolo_server:app` - Module and FastAPI app instance to run
- `--host 0.0.0.0` - Listen on all network interfaces
- `--port 8765` - HTTP port to listen on (change as needed)

**Output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8765
INFO:     Application startup complete
```

### Alternative: Run with Auto-Reload (Development)

```bash
uvicorn yolo_server:app --host 0.0.0.0 --port 8765 --reload
```

This reloads the server when you modify `yolo_server.py`.

## API Endpoints

### 1. List Available Models
```
GET /models
```
Returns available `.pt` files in the `models/` directory.

**Response:**
```json
{
  "models": ["model1.pt", "model2.pt"]
}
```

### 2. Get Model Info
```
GET /model-info
```
Returns information about the default model.

**Response:**
```json
{
  "classes": ["class1", "class2"],
  "model_file": "/path/to/model.pt",
  "num_classes": 2
}
```

### 3. Start Detection Task
```
POST /start
```
Start a detection task on a video stream.

**Request Body:**
```json
{
  "stream_url": "rtmp://example.com/stream",
  "callback_url": "http://your-server.com/detections",
  "class_filter": "person",            // (optional) filter by class name
  "confidence": 0.5,                   // (optional) detection confidence threshold (0-1)
  "task_id": "custom-id",              // (optional) custom task ID
  "model_name": "custom_model.pt"      // (optional) specific model to use
}
```

**Response:**
```json
{
  "task_id": "generated-or-provided-id"
}
```

Detection results will be POSTed to the `callback_url` as they're detected.

### 4. Stop Detection Task
```
POST /stop
```
Stop a running detection task.

**Request Body:**
```json
{
  "task_id": "task-id-to-stop"
}
```

**Response:**
```json
{
  "status": "stopped"
}
```

### 5. Health Check
```
GET /health
```
Check if the server is running.

**Response:**
```json
{
  "status": "ok"
}
```

## Example Usage

### 1. Check Available Models
```bash
curl http://localhost:8765/models
```

### 2. Start Detection on a Stream
```bash
curl -X POST http://localhost:8765/start \
  -H "Content-Type: application/json" \
  -d '{
    "stream_url": "rtmp://camera.local/stream",
    "callback_url": "http://localhost:3000/detections",
    "confidence": 0.6
  }'
```

### 3. Stop Detection
```bash
curl -X POST http://localhost:8765/stop \
  -H "Content-Type: application/json" \
  -d '{"task_id": "returned-task-id"}'
```

## Troubleshooting

### "No module named 'ultralytics'"
```bash
pip install ultralytics
```

### "No model found" Error
Ensure you have a `.pt` file in either:
- `ai_plugins/models/` directory
- `ai_plugins/screen_ads/best.pt`

### Model is very slow to load
YOLOv8 models are loaded on first use. Subsequent requests using the same model will be faster due to caching.

### Port 8765 already in use
Change the port:
```bash
uvicorn yolo_server:app --host 0.0.0.0 --port 9000
```

## Configuration

The server automatically loads models based on this priority:
1. Explicitly requested model via `model_name` parameter
2. Default model from `screen_ads/best.pt`
3. Any `.pt` files in the `models/` directory

CORS (Cross-Origin Resource Sharing) is enabled for all origins to allow requests from different domains.
