# ===== Stage 1: 安装依赖 =====
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS builder

WORKDIR /build
COPY checkin/package*.json checkin/
COPY reader/package*.json reader/

RUN cd checkin && npm ci --omit=dev && \
    cd ../reader && npm ci --omit=dev

# ===== Stage 2: 运行环境 =====
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# xvfb 用于 VPS Docker 场景下提供虚拟桌面规避无头检测
# Render 环境下 bot.js 内置调度器会自动检测并决定是否使用
RUN apt-get update && \
    apt-get install -y --no-install-recommends xvfb && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 创建低权限用户
RUN groupadd -r v2ex && useradd -r -g v2ex -d /home/v2ex -s /bin/bash v2ex && \
    mkdir -p /home/v2ex /data /app && \
    chown -R v2ex:v2ex /home/v2ex /data /app

WORKDIR /app

# 只复制业务代码（.dockerignore 排除了 .git, docs, scripts 等）
COPY --chown=v2ex:v2ex checkin/ checkin/
COPY --chown=v2ex:v2ex reader/*.js reader/
COPY --chown=v2ex:v2ex reader/package*.json reader/
COPY --chown=v2ex:v2ex .v2ex_env.example .v2ex_env.example

# 从 builder 阶段复制已安装的 node_modules
COPY --from=builder --chown=v2ex:v2ex /build/checkin/node_modules checkin/node_modules
COPY --from=builder --chown=v2ex:v2ex /build/reader/node_modules reader/node_modules

# 创建数据目录并确保权限
RUN mkdir -p /app/reader/data && chown -R v2ex:v2ex /app/reader/data

# 数据卷：Cookie 和日志持久化
VOLUME /data
ENV COOKIE_FILE=/data/.v2ex_cookie
ENV READER_LOG=/data/v2ex-reader.log
ENV HOME=/home/v2ex

# 健康检查：每 60 秒检测 bot.js 是否存活
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:'+(process.env.PORT||10000)+'/',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# 以低权限用户运行
USER v2ex

CMD ["node", "reader/bot.js"]
