# Video Processing Server

Server-side video cutting service using FFmpeg. No browser processing - all video cutting happens on the server.

## Stack

- **Node.js** - Runtime
- **Express** - Web framework
- **Multer** - File uploads
- **fluent-ffmpeg** - FFmpeg wrapper
- **ffmpeg-static** - Bundled FFmpeg binary

## Setup

```bash
cd video-processing-server
npm install
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |

## API Endpoints

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "ffmpeg": "/path/to/ffmpeg"
}
```

### Cut Video

```
POST /cut-video
Content-Type: multipart/form-data
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `video` | File | Video file (mp4, webm, mov, avi, mpeg) |
| `cuts` | JSON string | Array of cut segments |

**Cuts Format:**

```json
[
  { "start": "00:00:05", "end": "00:00:12" },
  { "start": "00:00:20", "end": "00:00:30" }
]
```

Timestamps can be:
- `HH:MM:SS` (e.g., "00:01:30")
- `MM:SS` (e.g., "01:30")
- Seconds as number (e.g., 90)

**Response:**

```json
{
  "success": true,
  "cuts": ["cuts/abc123.mp4", "cuts/def456.mp4"],
  "processingTime": "12.34s"
}
```

### Download Cuts

```
GET /cuts/:filename
```

## Deployment

### Railway

1. Push to GitHub
2. Connect repo to Railway
3. Deploy automatically

### Render

1. Create new Web Service
2. Connect GitHub repo
3. Build Command: `npm install`
4. Start Command: `npm start`

### Fly.io

```bash
fly launch
fly deploy
```

### Docker (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## FFmpeg Settings

The server uses professional encoding settings:

- **Video Codec:** libx264
- **Audio Codec:** AAC
- **Preset:** veryfast (good balance of speed/quality)
- **CRF:** 23 (high quality)
- **Movflags:** faststart (web streaming optimized)

## Limits

- Max file size: 2GB
- Supported formats: mp4, webm, mov, avi, mpeg

## Example Usage

### cURL

```bash
curl -X POST http://localhost:3001/cut-video \
  -F "video=@my-video.mp4" \
  -F 'cuts=[{"start":"00:00:05","end":"00:00:15"},{"start":"00:01:00","end":"00:01:30"}]'
```

### JavaScript (Frontend)

```javascript
const formData = new FormData();
formData.append('video', videoFile);
formData.append('cuts', JSON.stringify([
  { start: '00:00:05', end: '00:00:12' },
  { start: '00:00:20', end: '00:00:30' }
]));

const response = await fetch('https://your-server.com/cut-video', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result.cuts); // ["cuts/abc.mp4", "cuts/def.mp4"]
```

## License

MIT
