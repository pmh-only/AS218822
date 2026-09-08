"""Packet-level tests; run only in a disposable --network none Docker container."""

import ipaddress
import json
from pathlib import Path
import socket
import struct
import subprocess
import time


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs)


def nft(rules):
    return run("nft", "-f", "-", input=rules)


def counter(name, table="as218822_sav"):
    data = json.loads(run("nft", "-j", "list", "counter", "inet", table, name))
    return next(item["counter"]["packets"] for item in data["nftables"] if "counter" in item)


def checksum(data):
    if len(data) % 2:
        data += b"\0"
    total = sum(struct.unpack(f"!{len(data) // 2}H", data))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    return (~total & 0xFFFF) or 0xFFFF


def packet(source, destination, payload=b"", protocol=17, hops=64):
    src = ipaddress.ip_address(source).packed
    dst = ipaddress.ip_address(destination).packed
    if not payload:
        payload = struct.pack("!HHHH", 12345, 54321, 8, 0)
        if len(src) == 16:
            pseudo = src + dst + struct.pack("!I3xB", len(payload), protocol)
            payload = payload[:6] + struct.pack("!H", checksum(pseudo + payload))
    if len(src) == 16:
        return struct.pack("!IHBB", 6 << 28, len(payload), protocol, hops) + src + dst + payload
    header = struct.pack("!BBHHHBBH", 0x45, 0, 20 + len(payload), 0, 0, hops, protocol, 0) + src + dst
    return header[:10] + struct.pack("!H", checksum(header)) + header[12:] + payload


def inject(interface, source, destination, **kwargs):
    mac = json.loads(run("ip", "-j", "link", "show", interface))[0]["address"]
    family = b"\x86\xdd" if ":" in source else b"\x08\x00"
    frame = bytes.fromhex(mac.replace(":", "")) + b"\x02\0\0\0\0\x02" + family
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW) as sender:
        sender.bind(("p-" + interface, 0))
        sender.send(frame + packet(source, destination, **kwargs))


def local(source, destination, interface=None, **kwargs):
    with socket.socket(socket.AF_INET6, socket.SOCK_RAW, socket.IPPROTO_RAW) as sender:
        scope = socket.if_nametoindex(interface) if interface else 0
        try:
            sender.sendto(packet(source, destination, **kwargs), (destination, 0, 0, scope))
        except PermissionError:
            # Netfilter reports an output drop to a local sender as EPERM.
            pass


def expect(label, send, name, table="as218822_sav"):
    before = counter(name, table)
    send()
    for _ in range(100):
        if counter(name, table) == before + 1:
            print(f"PASS {label}", flush=True)
            return
        time.sleep(0.01)
    raise AssertionError(f"{label}: {name} did not increment by one")


def load(config):
    run("nft", "-c", "-f", config)
    run("nft", "-f", config)
    run("nft", "-f", config)
    # Replacing our table must leave unrelated firewall state intact.
    run("nft", "list", "table", "inet", "test_observer")


# Refuse accidental execution on an operator's host or a networked container.
links = json.loads(run("ip", "-j", "link", "show"))
assert Path("/.dockerenv").exists() and [link["ifname"] for link in links] == ["lo"]
for setting in ("net.ipv6.conf.all.forwarding", "net.ipv4.ip_forward"):
    assert run("sysctl", "-n", setting).strip() == "1", f"Pass --sysctl {setting}=1 to Docker"
nft("""
table inet test_observer {
    counter passed { }
    counter delivered { }
    counter neighbor_discovery { }
    chain observe_input {
        type filter hook input priority -50; policy accept;
        udp dport 54321 counter name delivered
    }
    chain observe {
        type filter hook postrouting priority 120; policy accept;
        ip6 daddr 2606:4700::1111 counter name passed
        oifname "zt-test" icmpv6 type nd-neighbor-solicit counter name neighbor_discovery
    }
}
""")

for interface in ("client", "lunalight", "tailscale0", "core"):
    run("ip", "link", "add", interface, "type", "veth", "peer", "name", "p-" + interface)
    for side in (interface, "p-" + interface):
        run("ip", "link", "set", side, "addrgenmode", "none")
        run("ip", "link", "set", side, "up")
    run("ip", "-6", "address", "add", "fd00:ffff::1/128", "dev", interface, "nodad")

for interface in ("bgptunnel-es", "zt-test", "hkix-gretap", "uplink"):
    if interface == "zt-test":
        run("ip", "link", "add", interface, "type", "veth", "peer", "name", "p-zt-test")
        run("ip", "link", "set", "p-zt-test", "addrgenmode", "none")
        run("ip", "link", "set", "p-zt-test", "up")
    else:
        run("ip", "link", "add", interface, "type", "dummy")
    run("ip", "link", "set", interface, "addrgenmode", "none")
    run("ip", "link", "set", interface, "up")
    run("ip", "-6", "neigh", "replace", "2606:4700::1111", "lladdr", "02:00:00:00:00:03", "dev", interface, "nud", "permanent")
run("ip", "-6", "address", "add", "2a06:9801:ff0::/128", "dev", "lo", "nodad")
run("ip", "address", "add", "192.0.2.254/24", "dev", "client")
run("ip", "-6", "route", "add", "2606:4700::1111/128", "dev", "bgptunnel-es")
run("ip", "route", "add", "198.51.100.1/32", "dev", "bgptunnel-es")

load("/routing/bird/source-validation.nft")
expect("own source forwarded", lambda: inject("client", "2a06:9801:ff0::2", "2606:4700::1111"), "egress_valid")
expect("customer source forwarded", lambda: inject("client", "2a0f:6284:b::2", "2606:4700::1111"), "egress_valid")
for source in ("2001:4860::bad", "fd00::bad", "2a0f:6284:d::1", "2a0c:9a40:a008::4a"):
    expect(f"foreign/non-service/forwarded-transport source {source}", lambda: inject("client", source, "2606:4700::1111"), "egress_spoof")
expect("IPv4 payload cannot escape routing tunnel", lambda: inject("client", "192.0.2.1", "198.51.100.1"), "egress_spoof")
expect("router own source", lambda: local("2a06:9801:ff0::", "2606:4700::1111"), "egress_valid")
expect("router transport source", lambda: local("2a0c:9a40:a008::4a", "2606:4700::1111"), "egress_valid")
expect("router cannot forge customer source", lambda: local("2a0f:6284:b::1", "2606:4700::1111"), "local_spoof")
expect("router cannot forge third-party source", lambda: local("2001:4860::bad", "2606:4700::1111"), "local_spoof")
expect("Tailscale cannot forge a public source", lambda: inject("tailscale0", "2a06:9801:ff0::2", "2606:4700::1111"), "ingress_spoof")
expect("Tailscale cannot forge an IPv4 source", lambda: inject("tailscale0", "192.0.2.1", "198.51.100.1"), "ingress_spoof")
expect("untranslated Tailscale source cannot escape", lambda: inject("tailscale0", "fd7a:115c:a1e0::2", "2606:4700::1111"), "egress_spoof")
nft("""
table ip6 test_nat {
    chain translate_source {
        type nat hook postrouting priority 100; policy accept;
        iifname "tailscale0" snat to 2a06:9801:ff0::
    }
}
""")
expect("Tailscale source validated after SNAT", lambda: inject("tailscale0", "fd7a:115c:a1e0::3", "2606:4700::1111"), "egress_valid")
run("nft", "delete", "table", "ip6", "test_nat")

run("ip", "-6", "route", "replace", "2606:4700::1111/128", "dev", "zt-test")
expect("ZeroTier wildcard also filters egress", lambda: inject("client", "2001:4860::bad", "2606:4700::1111"), "egress_spoof")
# Bypass global-source checks only for actual on-link neighbor discovery.
run("ip", "-6", "route", "add", "ff02::/16", "dev", "zt-test")
run("ip", "-6", "address", "add", "fe80::1/64", "dev", "zt-test", "nodad")
before = counter("egress_spoof")
local("::", "ff02::1:ff00:1", interface="zt-test", payload=b"\x87" + b"\0" * 23, protocol=58, hops=255)
assert counter("egress_spoof") == before, "DAD neighbor discovery was dropped"
local("::", "ff02::1:ff00:1", interface="zt-test", payload=b"\x87" + b"\0" * 23, protocol=58, hops=64)
assert counter("egress_spoof") == before + 1, "invalid neighbor discovery hop limit was allowed"
print("PASS scoped neighbor discovery", flush=True)
before = counter("egress_spoof")
local("fe80::1", "ff02::16", interface="zt-test", payload=b"\x8f" + b"\0" * 7, protocol=58, hops=1)
assert counter("egress_spoof") == before, "MLD membership report was dropped"
local("fe80::1", "ff02::16", interface="zt-test", payload=b"\x8f" + b"\0" * 7, protocol=58, hops=64)
assert counter("egress_spoof") == before + 1, "non-link-local MLD hop limit was allowed"
print("PASS scoped multicast listener discovery", flush=True)
run("ip", "-6", "address", "add", "2a0e:8f01:1000:16::157/64", "dev", "zt-test", "nodad")
with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM) as sender:
    expect("kernel-generated neighbor discovery", lambda: sender.sendto(b"test", ("2a0e:8f01:1000:16::1", 54321)), "neighbor_discovery", "test_observer")

load("/routing/edge/gre-gateway/bird/source-validation.nft")
run("ip", "-6", "address", "add", "fd00:218:822:2014:23::/127", "dev", "lunalight", "nodad")
run("ip", "-6", "route", "replace", "2606:4700::1111/128", "dev", "hkix-gretap")
expect("Lunalight peering traffic preserved", lambda: inject("lunalight", "fd00:218:822:2014:23::1", "fd00:218:822:2014:23::"), "delivered", "test_observer")
for source in ("2a0f:6284:b::2", "2a0f:6284:c::2"):
    expect(f"Lunalight authorized source {source}", lambda: inject("lunalight", source, "2606:4700::1111"), "egress_valid")
for destination in ("2606:4700::1111", "fd00:ffff::1"):
    expect(f"Lunalight spoof rejected before forwarding or input to {destination}", lambda: inject("lunalight", "2a06:9801:ff0::2", destination), "ingress_spoof")
expect("Lunalight IPv4 rejected", lambda: inject("lunalight", "192.0.2.1", "198.51.100.1"), "ingress_spoof")
expect("Lunalight peering source is link-only", lambda: inject("lunalight", "fd00:218:822:2014:23::1", "2606:4700::1111"), "ingress_spoof")
expect("GRE external egress validated", lambda: inject("client", "2001:4860::bad", "2606:4700::1111"), "egress_spoof")
# Returning Internet traffic toward the core/customer is not external egress.
run("ip", "-6", "route", "replace", "2606:4700::1111/128", "dev", "core")
run("ip", "-6", "neigh", "replace", "2606:4700::1111", "lladdr", "02:00:00:00:00:03", "dev", "core", "nud", "permanent")
expect("asymmetric Internet return traffic preserved", lambda: inject("client", "2001:4860::1", "2606:4700::1111"), "passed", "test_observer")

load("/routing/edge/vultr/bird/source-validation.nft")
run("ip", "-6", "address", "add", "fd00:218:822:473::1/127", "dev", "core", "nodad")
run("ip", "-6", "route", "replace", "2606:4700::1111/128", "dev", "uplink")
expect("Vultr core peering traffic preserved", lambda: inject("core", "fd00:218:822:473::", "fd00:218:822:473::1"), "delivered", "test_observer")
expect("Vultr core authorized source", lambda: inject("core", "2a06:9801:ff0::2", "2606:4700::1111"), "passed", "test_observer")
expect("Vultr core foreign source rejected", lambda: inject("core", "2001:4860::bad", "2606:4700::1111"), "ingress_spoof")
expect("Vultr core peering source is link-only", lambda: inject("core", "fd00:218:822:473::", "2606:4700::1111"), "ingress_spoof")
expect("Vultr local foreign source rejected", lambda: local("2001:4860::bad", "2606:4700::1111"), "local_spoof")

# Keep cryptographic WireGuard source checks aligned with the tested ingress ACLs.
for path, expected in (
    ("edge/gre-gateway/tunnels/wireguard/lunalight.conf", {"fd00:218:822:2014:23::1/128", "2a0f:6284:b::/48", "2a0f:6284:c::/48"}),
    ("edge/vultr/tunnels/wireguard/core.conf", {"fd00:218:822:473::/128", "2a06:9801:ff0::/44"}),
):
    lines = (Path("/routing") / path).read_text().splitlines()
    allowed = [line.split("=", 1)[1] for line in lines if line.startswith("AllowedIPs")]
    assert len(allowed) == 1 and {value.strip() for value in allowed[0].split(",")} == expected
print("PASS WireGuard source allowlists and atomic table replacement", flush=True)
