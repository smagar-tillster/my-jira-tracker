# Backend Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 3050

# Set environment variable for port
ENV PORT=3050

# Start the application
CMD ["npm", "run", "dev"]
