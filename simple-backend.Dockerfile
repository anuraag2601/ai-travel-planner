FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY simple-package.json package.json
COPY simple-backend.js server.js
COPY sales-dashboard.html sales-dashboard.html
COPY airport-city-mapping.js airport-city-mapping.js

# Install dependencies
RUN npm install --only=production

# Expose port
EXPOSE 8080

# No health check - Cloud Run handles this

# Start the application
CMD ["npm", "start"]