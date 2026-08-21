# =============================================================================
# JBB Tournament Manager — single-stage image
# PocketBase ships as one static Go binary; the frontend is plain HTML/JS
# with no build step.
# =============================================================================
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /pb

COPY pocketbase        ./pocketbase
COPY pb_migrations     ./pb_migrations
COPY pb_public         ./pb_public

RUN mkdir -p /pb/pb_data && \
    chmod +x ./pocketbase && \
    adduser -D -H -u 1000 pbuser && \
    chown -R pbuser:pbuser /pb

USER pbuser

EXPOSE 8090
VOLUME ["/pb/pb_data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
