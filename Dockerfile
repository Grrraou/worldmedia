FROM nginx:alpine

# Remove default nginx static content
RUN rm -rf /usr/share/nginx/html/*

# Restrict served paths to index.html, app.js, styles.css, /data/*, /assets/* only
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy project static files and map data
COPY index.html styles.css app.js /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/
COPY assets/ /usr/share/nginx/html/assets/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
