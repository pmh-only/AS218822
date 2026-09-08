FROM debian:trixie-slim AS build

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential ca-certificates curl libpcap-dev libprotobuf-dev \
        libssl-dev protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/spoofer
RUN curl --fail --show-error --location \
        https://www.caida.org/projects/spoofer/downloads/spoofer-1.5.0.tar.gz \
        --output /tmp/spoofer.tar.gz \
    && printf '%s\n' 'b9641c7ca02cf07a3c661fbaedec515493b233d8beb20bbfeedf2fb95586c885  /tmp/spoofer.tar.gz' | sha256sum --check \
    && tar -xzf /tmp/spoofer.tar.gz --strip-components=1 \
    && ./configure --disable-manager --prefix=/usr/local \
    && make -j2 \
    && make install

FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ca-certificates iproute2 libpcap0.8t64 libprotobuf-lite32t64 \
        libssl3t64 libstdc++6 traceroute wireguard-tools \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/spoofer-prober /usr/local/bin/spoofer-prober
COPY --chmod=0755 run-spoofer /usr/local/bin/run-spoofer

WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/run-spoofer"]
