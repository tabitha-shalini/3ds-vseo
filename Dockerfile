# 3DS VSEO - Video SEO Optimizer
# Use official Node.js runtime
FROM node:18-alpine

# Install system dependencies for video processing
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    git \
    curl

# Install yt-dlp for YouTube audio extraction
RUN pip3 install yt-dlp

# Verify installations
RUN yt-dlp --version && ffmpeg -version

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create temp directory and set permissions
RUN mkdir -p /tmp && chmod 777 /tmp

# Expose port (Render will set this automatically)
EXPOSE $PORT

# Health check for monitoring
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:$PORT/api/health || exit 1

# Start the 3DS VSEO application
CMD ["npm", "start"]