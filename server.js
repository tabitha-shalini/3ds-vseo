const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const OpenAI = require('openai');

const execAsync = promisify(exec);
const app = express();

// Configure multer for file uploads
const upload = multer({ 
  dest: '/tmp/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// Memory monitoring
const logMemoryUsage = () => {
  const used = process.memoryUsage();
  console.log('Memory usage:', {
    rss: Math.round(used.rss / 1024 / 1024) + 'MB',
    heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB',
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB'
  });
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  logMemoryUsage();
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Main page - API info
app.get('/', (req, res) => {
  res.json({
    message: '🎥 3DS VSEO - Video SEO Optimizer API',
    status: 'running',
    endpoints: {
      health: '/api/health',
      app: '/app',
      processVideo: '/api/process-video (Tier 1)',
      transcribeYoutube: '/api/transcribe-youtube (Tier 2)',
      transcribeAudio: '/api/transcribe-audio (Tier 2)',
      optimizeContent: '/api/optimize-content (Tier 2)'
    },
    version: '2.0.0'
  });
});

// Serve the main web app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =============================================================================
// TIER 1: FULL AUTOMATION ENDPOINTS
// =============================================================================

// Main automation endpoint - downloads, transcribes, and sends to n8n
app.post('/api/process-video', async (req, res) => {
  const { youtubeUrl, whisperApiKey, n8nWebhookUrl } = req.body;
  let tempFiles = [];
  
  try {
    console.log('🚀 TIER 1: Starting full automation for:', youtubeUrl);
    logMemoryUsage();
    
    // Validate inputs
    if (!youtubeUrl || !whisperApiKey || !n8nWebhookUrl) {
      return res.status(400).json({ 
        error: 'Missing required fields: youtubeUrl, whisperApiKey, or n8nWebhookUrl' 
      });
    }
    
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    
    // Step 1: Download audio
    console.log('📥 Downloading audio...');
    const audioPath = await downloadYouTubeAudio(videoId);
    tempFiles.push(audioPath);
    
    console.log('📁 Audio downloaded:', await getFileSize(audioPath));
    logMemoryUsage();
    
    // Step 2: Transcribe with Whisper
    console.log('🤖 Transcribing with Whisper...');
    const transcription = await transcribeWithWhisper(audioPath, whisperApiKey);
    console.log('📝 Transcription completed, length:', transcription.length);
    
    // Step 3: Get video metadata
    console.log('📊 Getting video metadata...');
    const videoMetadata = await getVideoMetadata(videoId);
    
    // Step 4: Prepare payload for n8n
    const payload = {
      videoId,
      youtubeUrl,
      transcription,
      currentTitle: videoMetadata.title,
      currentDescription: videoMetadata.description,
      duration: videoMetadata.duration,
      publishedAt: videoMetadata.publishedAt,
      uploader: videoMetadata.uploader,
      processingTimestamp: new Date().toISOString()
    };
    
    console.log('📤 Sending to n8n webhook...');
    
    // Step 5: Send to n8n for automation
    const n8nResponse = await sendToN8n(n8nWebhookUrl, payload);
    
    console.log('✅ TIER 1: Automation initiated successfully');
    
    res.json({
      success: true,
      videoId,
      transcription: transcription.substring(0, 300) + '...',
      metadata: videoMetadata,
      n8nResponse,
      message: 'Video sent for automation! Check your n8n workflow for progress.'
    });
    
  } catch (error) {
    console.error('❌ TIER 1 Error:', error);
    res.status(500).json({ 
      error: error.message,
      videoId: extractVideoId(youtubeUrl)
    });
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    logMemoryUsage();
    forceGarbageCollection();
  }
});

// =============================================================================
// TIER 2: MANUAL PREVIEW ENDPOINTS
// =============================================================================

// Transcribe YouTube video only (for preview)
app.post('/api/transcribe-youtube', async (req, res) => {
  const { youtubeUrl, whisperApiKey } = req.body;
  let tempFiles = [];
  
  try {
    console.log('📝 TIER 2: Transcribing YouTube video:', youtubeUrl);
    
    if (!youtubeUrl || !whisperApiKey) {
      return res.status(400).json({ 
        error: 'Missing required fields: youtubeUrl or whisperApiKey' 
      });
    }
    
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    
    // Download and transcribe
    const audioPath = await downloadYouTubeAudio(videoId);
    tempFiles.push(audioPath);
    
    const transcription = await transcribeWithWhisper(audioPath, whisperApiKey);
    
    console.log('✅ TIER 2: Transcription completed');
    
    res.json({
      success: true,
      transcription,
      videoId,
      audioSize: await getFileSize(audioPath)
    });
    
  } catch (error) {
    console.error('❌ TIER 2 Transcription Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await cleanupFiles(tempFiles);
  }
});

// Transcribe uploaded audio file
app.post('/api/transcribe-audio', upload.single('audio'), async (req, res) => {
  try {
    const { whisperApiKey } = req.body;
    const audioFile = req.file;
    
    console.log('🎵 TIER 2: Transcribing uploaded file:', audioFile?.originalname);
    
    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    if (!whisperApiKey) {
      return res.status(400).json({ error: 'Missing whisperApiKey' });
    }
    
    const transcription = await transcribeWithWhisper(audioFile.path, whisperApiKey);
    
    console.log('✅ TIER 2: File transcription completed');
    
    res.json({
      success: true,
      transcription,
      fileInfo: {
        originalName: audioFile.originalname,
        size: audioFile.size,
        type: audioFile.mimetype
      }
    });
    
  } catch (error) {
    console.error('❌ TIER 2 File Transcription Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup uploaded file
    if (req.file) {
      await cleanupFiles([req.file.path]);
    }
  }
});

// Generate content optimization suggestions
app.post('/api/optimize-content', async (req, res) => {
  try {
    const { transcription, chatGptApiKey, youtubeUrl } = req.body;
    
    console.log('✨ TIER 2: Generating optimization suggestions');
    
    if (!transcription || !chatGptApiKey) {
      return res.status(400).json({ 
        error: 'Missing required fields: transcription or chatGptApiKey' 
      });
    }
    
    // Get current video metadata if YouTube URL provided
    let currentMetadata = null;
    if (youtubeUrl) {
      const videoId = extractVideoId(youtubeUrl);
      if (videoId) {
        try {
          currentMetadata = await getVideoMetadata(videoId);
        } catch (error) {
          console.warn('Could not fetch video metadata:', error.message);
        }
      }
    }
    
    // Generate optimization with ChatGPT
    const optimization = await generateOptimization(transcription, currentMetadata, chatGptApiKey);
    
    console.log('✅ TIER 2: Optimization completed');
    
    res.json(optimization);
    
  } catch (error) {
    console.error('❌ TIER 2 Optimization Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Download YouTube audio with optimization for memory
async function downloadYouTubeAudio(videoId) {
  const outputPath = `/tmp/${videoId}.%(ext)s`;
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    // Check if yt-dlp is available
    await execAsync('which yt-dlp', { timeout: 5000 });
    
    // Download with optimizations for smaller file size
    const command = `yt-dlp -x --audio-format wav --audio-quality 5 --postprocessor-args "ffmpeg:-ac 1 -ar 16000" -o "${outputPath}" "${youtubeUrl}"`;
    
    console.log('⬇️ Downloading audio with optimizations...');
    await execAsync(command, { 
      timeout: 300000, // 5 minute timeout
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer
    });
    
    // Find the downloaded file
    const files = await fs.readdir('/tmp');
    const audioFile = files.find(file => file.startsWith(videoId) && file.endsWith('.wav'));
    
    if (!audioFile) {
      throw new Error('Audio file not found after download');
    }
    
    return path.join('/tmp', audioFile);
    
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
}

// Transcribe audio using OpenAI Whisper
async function transcribeWithWhisper(audioPath, apiKey) {
  const openai = new OpenAI({ apiKey });
  
  try {
    // Check file size
    const stats = await fs.stat(audioPath);
    if (stats.size > 25 * 1024 * 1024) {
      throw new Error('Audio file too large for Whisper API (>25MB)');
    }
    
    console.log('🤖 Starting Whisper transcription...');
    const audioBuffer = await fs.readFile(audioPath);
    
    const transcription = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], 'audio.wav', { type: 'audio/wav' }),
      model: 'whisper-1',
      response_format: 'text',
      language: 'en'
    });
    
    return transcription;
    
  } catch (error) {
    throw new Error(`Whisper transcription failed: ${error.message}`);
  }
}

// Get YouTube video metadata
async function getVideoMetadata(videoId) {
  try {
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const command = `yt-dlp --no-download --print "%(title)s|%(description)s|%(duration)s|%(upload_date)s|%(uploader)s|%(view_count)s" "${youtubeUrl}"`;
    
    const { stdout } = await execAsync(command, { timeout: 30000 });
    const [title, description, duration, uploadDate, uploader, viewCount] = stdout.trim().split('|');
    
    return {
      title: title || 'Unknown Title',
      description: (description || '').substring(0, 1000), // Limit description length
      duration: parseInt(duration) || 0,
      publishedAt: uploadDate || null,
      uploader: uploader || 'Unknown',
      viewCount: parseInt(viewCount) || 0
    };
    
  } catch (error) {
    console.warn('⚠️ Metadata extraction failed:', error.message);
    return {
      title: 'Unknown Title',
      description: 'No description available',
      duration: 0,
      publishedAt: null,
      uploader: 'Unknown',
      viewCount: 0
    };
  }
}

// Generate content optimization using ChatGPT
async function generateOptimization(transcription, currentMetadata, apiKey) {
  const openai = new OpenAI({ apiKey });
  
  try {
    const currentTitle = currentMetadata?.title || 'Unknown Title';
    const currentDescription = currentMetadata?.description || 'No description available';
    const duration = currentMetadata?.duration || 0;
    
    const prompt = `You are a YouTube optimization expert. Based on this video transcription, generate optimized metadata.

**CURRENT METADATA:**
Title: ${currentTitle}
Description: ${currentDescription}
Duration: ${Math.floor(duration / 60)} minutes ${duration % 60} seconds

**TRANSCRIPTION:**
${transcription}

**TASK:** Generate optimized YouTube metadata following these guidelines:

1. **TITLE REQUIREMENTS:**
   - Maximum 60 characters
   - Include primary keyword from content
   - Make it clickable but not clickbait
   - Consider current YouTube trends

2. **DESCRIPTION REQUIREMENTS:**
   - Hook in first 125 characters (mobile preview)
   - Include 3-5 relevant keywords naturally
   - Add clear value proposition
   - Include call-to-action
   - Add relevant timestamps if content supports chapters

3. **TAGS REQUIREMENTS:**
   - 10-15 tags total
   - Mix of broad and specific terms
   - Include variations of main keywords
   - Add trending related terms

4. **CHAPTERS (if applicable):**
   - Only if content has clear segments
   - Descriptive chapter titles
   - Accurate timestamps

Respond in this exact JSON format:
{
  "title": "Your optimized title here",
  "description": "Your full optimized description",
  "tags": ["tag1", "tag2", "tag3"],
  "chapters": [
    {"time": "0:00", "title": "Introduction"},
    {"time": "2:30", "title": "Main Topic"}
  ],
  "seo_analysis": {
    "primary_keywords": ["keyword1", "keyword2"],
    "content_category": "educational/entertainment/tutorial/etc",
    "target_audience": "description of audience",
    "optimization_notes": "brief notes on optimization strategy"
  }
}`;

    console.log('🤖 Generating optimization with ChatGPT...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a YouTube optimization expert. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 3000
    });
    
    const content = response.choices[0].message.content;
    
    try {
      return JSON.parse(content);
    } catch (parseError) {
      throw new Error('Failed to parse ChatGPT response as JSON');
    }
    
  } catch (error) {
    throw new Error(`Content optimization failed: ${error.message}`);
  }
}

// Send data to n8n webhook
async function sendToN8n(webhookUrl, payload) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': '3DS-VSEO/2.0'
      },
      body: JSON.stringify(payload),
      timeout: 30000
    });
    
    if (!response.ok) {
      throw new Error(`n8n webhook failed: HTTP ${response.status} - ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ n8n webhook successful');
    return result;
    
  } catch (error) {
    console.error('❌ n8n webhook failed:', error.message);
    throw new Error(`Failed to send to n8n: ${error.message}`);
  }
}

// Helper functions
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return `${Math.round(stats.size / 1024 / 1024 * 100) / 100}MB`;
  } catch {
    return 'Unknown size';
  }
}

async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
      console.log('🗑️ Cleaned up:', filePath);
    } catch (error) {
      console.warn('⚠️ Cleanup failed:', filePath, error.message);
    }
  }
}

function forceGarbageCollection() {
  if (global.gc) {
    global.gc();
    console.log('🗑️ Garbage collection triggered');
  }
}

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 3DS VSEO running on port ${PORT}`);
  console.log(`📱 Web interface: http://localhost:${PORT}/app`);
  console.log(`🔗 API health: http://localhost:${PORT}/api/health`);
  console.log('🎯 Features: Tier 1 (Full Auto) + Tier 2 (Manual Preview)');
  logMemoryUsage();
});

module.exports = app;