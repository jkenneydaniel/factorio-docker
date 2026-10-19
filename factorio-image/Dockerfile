ARG BASE_IMAGE=debian:bookworm-slim@sha256:a4672c0cb26fbdde88e38fa2dfb6c681942306680e41e4378b28770b6e79ee91
FROM ${BASE_IMAGE}
ARG TARGETARCH
ARG FACTORIO_VERSION=2.0.77
ARG HEADLESS_SHA256=c4efc11529f74d37c96933e291e0db73fd9f5aa4738913d9301b24680b3e947f
ARG IMAGE_REVISION=2
LABEL org.opencontainers.image.title="Factory Control Factorio Server" \
      org.opencontainers.image.source="https://github.com/jkenneydaniel/factorio-docker" \
      org.opencontainers.image.version="${FACTORIO_VERSION}-fc.${IMAGE_REVISION}" \
      factorio.version="${FACTORIO_VERSION}" \
      io.factory-control.compatibility="1" \
      io.factory-control.image-revision="${IMAGE_REVISION}"
RUN test "$TARGETARCH" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils python3 passwd libstdc++6 \
    && curl --fail --location --retry 3 "https://www.factorio.com/get-download/${FACTORIO_VERSION}/headless/linux64" -o /tmp/factorio.tar.xz \
    && echo "${HEADLESS_SHA256}  /tmp/factorio.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/factorio.tar.xz -C /opt \
    && rm /tmp/factorio.tar.xz \
    && apt-get purge -y --auto-remove curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 845 factorio \
    && useradd --system --uid 845 --gid 845 --no-create-home --shell /bin/sh factorio \
    && mkdir -p /factorio /opt/factorio/config /usr/local/lib/factory-control \
    && ln -s /factorio/saves /opt/factorio/saves \
    && ln -s /factorio/scenarios /opt/factorio/scenarios \
    && chown -R 845:845 /opt/factorio /factorio
COPY config.ini /opt/factorio/config/config.ini
COPY entrypoint.py /usr/local/lib/factory-control/entrypoint.py
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY rcon.py /usr/local/bin/rcon
COPY LICENSE /usr/share/doc/factory-control/LICENSE
RUN chmod 755 /docker-entrypoint.sh /usr/local/bin/rcon \
    && /opt/factorio/bin/x64/factorio --version
ENV PORT=34197 RCON_PORT=27015 \
    SAVES=/factorio/saves CONFIG=/factorio/config MODS=/factorio/mods \
    SCENARIOS=/factorio/scenarios SCRIPTOUTPUT=/factorio/script-output \
    PUID=845 PGID=845 DLC_SPACE_AGE=true \
    LOAD_LATEST_SAVE=true GENERATE_NEW_SAVE=false UPDATE_MODS_ON_START=false
VOLUME /factorio
EXPOSE 34197/udp 27015/tcp
STOPSIGNAL SIGTERM
ENTRYPOINT ["/docker-entrypoint.sh"]
