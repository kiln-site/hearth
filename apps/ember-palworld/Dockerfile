FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl lib32gcc-s1 lib32stdc++6 libicu72 locales tini xdg-user-dirs \
  && sed -i 's/^# en_US.UTF-8 UTF-8$/en_US.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/steamcmd /server \
  && curl --fail --location --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 300 \
    https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
    | tar --extract --gzip --directory /opt/steamcmd \
  && chmod 0755 /opt/steamcmd/steamcmd.sh

RUN groupadd --gid 1000 kiln \
  && useradd --uid 1000 --gid kiln --home-dir /server --no-create-home --shell /usr/sbin/nologin kiln \
  && chown kiln:kiln /server

COPY apps/ember-palworld/ember.sh /usr/local/bin/kiln-ember-palworld
RUN chmod 0755 /usr/local/bin/kiln-ember-palworld

LABEL org.opencontainers.image.source="https://github.com/kiln-site/hearth"
LABEL org.opencontainers.image.title="Kiln Ember for Palworld"
LABEL org.opencontainers.image.description="SteamCMD runtime for Kiln-managed Palworld servers"

ENV HOME=/server
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
WORKDIR /server
EXPOSE 8211/udp
STOPSIGNAL SIGTERM
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kiln-ember-palworld"]
