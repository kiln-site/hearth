ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jdk-jammy AS java

RUN apt-get update \
  && apt-get install -y --no-install-recommends binutils \
  && rm -rf /var/lib/apt/lists/*

RUN compression=2; \
  if jlink --help | grep -q 'zip-[0-9]'; then compression=zip-6; fi; \
  jlink \
  --add-modules java.base,java.compiler,java.desktop,java.instrument,java.logging,java.management,java.naming,java.net.http,java.security.jgss,java.sql,jdk.crypto.ec,jdk.management,jdk.security.auth,jdk.unsupported,jdk.zipfs \
  --no-header-files \
  --no-man-pages \
  --strip-debug \
  --compress="${compression}" \
  --output /opt/kiln-java

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=java /opt/kiln-java /opt/java
COPY apps/bricks/embers/java/entrypoint.sh /usr/local/bin/kiln-ember
RUN chmod 0755 /usr/local/bin/kiln-ember && mkdir -p /server

LABEL org.opencontainers.image.source="https://github.com/kiln-site/hearth"
LABEL org.opencontainers.image.title="Kiln Java Ember"
LABEL org.opencontainers.image.description="Minimal Java runtime for recipe-driven Kiln Bricks"
LABEL kiln.ember.installation-marker="v1"

ENV JAVA_HOME=/opt/java
ENV PATH=/opt/java/bin:$PATH
WORKDIR /server
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kiln-ember"]
