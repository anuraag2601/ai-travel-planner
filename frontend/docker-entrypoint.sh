#!/bin/sh

# Replace environment variables in the built files
# This allows runtime configuration of environment variables

if [ -f /usr/share/nginx/html/index.html ]; then
    # Replace placeholder values with actual environment variables
    sed -i "s|VITE_API_BASE_URL_PLACEHOLDER|${VITE_API_BASE_URL:-http://localhost:8080/api/v1}|g" /usr/share/nginx/html/assets/*.js
    sed -i "s|VITE_FIREBASE_API_KEY_PLACEHOLDER|${VITE_FIREBASE_API_KEY}|g" /usr/share/nginx/html/assets/*.js
    sed -i "s|VITE_FIREBASE_AUTH_DOMAIN_PLACEHOLDER|${VITE_FIREBASE_AUTH_DOMAIN}|g" /usr/share/nginx/html/assets/*.js
    sed -i "s|VITE_FIREBASE_PROJECT_ID_PLACEHOLDER|${VITE_FIREBASE_PROJECT_ID}|g" /usr/share/nginx/html/assets/*.js
    sed -i "s|VITE_GOOGLE_MAPS_API_KEY_PLACEHOLDER|${VITE_GOOGLE_MAPS_API_KEY}|g" /usr/share/nginx/html/assets/*.js
fi

# Start nginx
exec "$@"