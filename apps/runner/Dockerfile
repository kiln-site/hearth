ARG JAVA_VERSION=21
FROM ghcr.io/graalvm/jdk-community:${JAVA_VERSION} AS java

RUN microdnf install -y binutils && microdnf clean all

RUN jlink \
  --add-modules java.base,java.compiler,java.desktop,java.instrument,java.logging,java.management,java.naming,java.net.http,java.security.jgss,java.sql,jdk.crypto.ec,jdk.management,jdk.security.auth,jdk.unsupported,jdk.zipfs \
  --no-header-files \
  --no-man-pages \
  --strip-debug \
  --compress=zip-6 \
  --output /opt/kiln-java

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=java /opt/kiln-java /opt/java
COPY apps/runner/runner.sh /usr/local/bin/kiln-runner
RUN chmod 0755 /usr/local/bin/kiln-runner && mkdir -p /server

ENV JAVA_HOME=/opt/java
ENV PATH=/opt/java/bin:$PATH
WORKDIR /server
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kiln-runner"]
