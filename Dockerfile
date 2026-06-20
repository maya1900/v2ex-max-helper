FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# 安装 cron 和 xvfb (提供虚拟桌面以规避无头检测)
RUN apt-get update && \
    apt-get install -y cron xvfb && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# 分别安装 reader 和 checkin 的依赖
RUN cd checkin && npm ci
RUN cd reader && npm ci

# 复制 crontab 配置文件并设置权限
COPY docker/crontab /etc/cron.d/v2ex-cron
RUN chmod 0644 /etc/cron.d/v2ex-cron && crontab /etc/cron.d/v2ex-cron

# 复制 entrypoint
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 创建数据卷供持久化 Cookie 和日志
VOLUME /data
ENV COOKIE_FILE=/data/.v2ex_cookie
ENV READER_LOG=/data/v2ex-reader.log

# 启动入口点
CMD ["/usr/local/bin/entrypoint.sh"]
