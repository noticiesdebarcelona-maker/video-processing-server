src/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3001;

// Create directories if they don't exist
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const CUTS_DIR = path.join(__dirname, '..', 'cuts');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(CUTS_DIR)) {
  fs.mkdirSync(CUTS_DIR, { recursive: true });
}

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Convert timestamp string to seconds
function timestampToSeconds(timestamp) {
  if (typeof timestamp === 'number') return timestamp;
  
  const parts = timestamp.split(':').map(Number);
  
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  
  return parseFloat(timestamp) || 0;
}

// Cut video using FFmpeg
function cutVideoSegment(inputPath, outputPath, startSeconds, endSeconds) {
  return new Promise((resolve, reject) => {
    const duration = endSeconds - startSeconds;

    ffmpeg(inputPath)
      .setStartTime(startSeconds)
      .setDuration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset veryfast',
        '-crf 23',
        '-movflags +faststart',
        '-avoid_negative_ts make_zero'
      ])
      .on('start', (cmd) => {
        console.log(`[FFmpeg] Starting: ${cmd}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`[FFmpeg] Progress: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        console.log(`[FFmpeg] Completed: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`[FFmpeg] Error: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ffmpeg: ffmpegPath });
});

// Main video cutting endpoint
app.post('/cut-video', upload.single('video'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validate video file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided. Use field name "video".'
      });
    }

    // Parse cuts array
    let cuts;
    try {
      cuts = JSON.parse(req.body.cuts || '[]');
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in "cuts" field.'
      });
    }

    if (!Array.isArray(cuts) || cuts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No cuts provided. Send an array of { start, end } objects.'
      });
    }

    console.log(`[Server] Processing ${cuts.length} cuts for: ${req.file.originalname}`);

    const inputPath = req.file.path;
    const results = [];
    const errors = [];

    // Process each cut
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i];
      const startSeconds = timestampToSeconds(cut.start);
      const endSeconds = timestampToSeconds(cut.end);

      if (endSeconds <= startSeconds) {
        errors.push({
          index: i,
          error: `Invalid time range: ${cut.start} to ${cut.end}`
        });
        continue;
      }

      const outputFilename = `${uuidv4()}.mp4`;
      const outputPath = path.join(CUTS_DIR, outputFilename);

      try {
        await cutVideoSegment(inputPath, outputPath, startSeconds, endSeconds);
        results.push(`cuts/${outputFilename}`);
        console.log(`[Server] Cut ${i + 1}/${cuts.length} completed`);
      } catch (cutError) {
        errors.push({
          index: i,
          error: cutError.message
        });
        console.error(`[Server] Cut ${i + 1} failed:`, cutError.message);
      }
    }

    // Clean up uploaded file
    try {
      fs.unlinkSync(inputPath);
    } catch (cleanupError) {
      console.warn('[Server] Failed to cleanup uploaded file:', cleanupError.message);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Server] Completed in ${duration}s: ${results.length} cuts, ${errors.length} errors`);

    res.json({
      success: results.length > 0,
      cuts: results,
      errors: errors.length > 0 ? errors : undefined,
      processingTime: `${duration}s`
    });

  } catch (error) {
    console.error('[Server] Error:', error);
    
    // Clean up uploaded file on error
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Serve cut files
app.use('/cuts', express.static(CUTS_DIR));

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('[Server] Unhandled error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'File too large. Maximum size is 2GB.'
      });
    }
  }
  
  res.status(500).json({
    success: false,
    error: error.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎬 Video Processing Server running on port ${PORT}`);
  console.log(`📁 Uploads: ${UPLOADS_DIR}`);
  console.log(`📁 Cuts: ${CUTS_DIR}`);
  console.log(`🔧 FFmpeg: ${ffmpegPath}`);
});
