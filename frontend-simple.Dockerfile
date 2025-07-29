FROM nginx:alpine

# Copy the HTML file to nginx html directory
COPY frontend-app.html /usr/share/nginx/html/index.html

# Create nginx config for SPA
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    \
    # Enable CORS \
    add_header "Access-Control-Allow-Origin" "*"; \
    add_header "Access-Control-Allow-Methods" "GET, POST, OPTIONS"; \
    add_header "Access-Control-Allow-Headers" "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range"; \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]