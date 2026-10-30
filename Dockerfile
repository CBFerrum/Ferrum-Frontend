# syntax=docker/dockerfile:1.7
# Ferrum web app: static files on unprivileged nginx, which also proxies the API, file downloads,
# the MCP endpoint and WebSockets to the Ferrum server (FERRUM_API_URL), so one origin serves all.
#   docker build -t ferrum-frontend .
#   docker run -p 8080:8080 -e FERRUM_API_URL=http://ferrum:5150 ferrum-frontend

FROM node:22-bookworm-slim AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /web/dist /usr/share/nginx/html/app
ENV FERRUM_API_URL=http://ferrum:5150
# The editor server for online editing (empty: none); see nginx/default.conf.template.
ENV FERRUM_OFFICE_ORIGIN=""
# The largest upload passed to the API; match the server's FERRUM_DRIVE_MAX_FILE_MB when raising it.
ENV FERRUM_MAX_UPLOAD=32m
EXPOSE 8080
