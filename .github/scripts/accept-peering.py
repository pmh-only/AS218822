#!/usr/bin/env python3
import argparse
import ipaddress
import json
import re
from pathlib import Path


OWN_PREFIX = ipaddress.ip_network("2a06:9801:ff0::/44")
PUBLIC_SPACE = ipaddress.ip_network("2000::/3")
SERVER_PUBLIC_KEY = "bzrmTDbQNHyonbc1jnouNvQqqNEjLKKzlowODgqLa0I="


def issue_fields(body):
    sections = re.split(r"^###\s+", body, flags=re.MULTILINE)[1:]
    fields = {}
    for section in sections:
        heading, _, value = section.partition("\n")
        fields[heading.strip()] = value.strip()
    return fields


def parse_request(event):
    issue = event["issue"]
    fields = issue_fields(issue.get("body") or "")
    required = (
        "Autonomous system number",
        "Network name",
        "IPv6 prefixes",
        "Maximum IPv6 prefixes",
        "PeeringDB profile",
    )
    missing = [name for name in required if not fields.get(name) or fields[name] == "_No response_"]
    if missing:
        raise ValueError(f"Missing issue fields: {', '.join(missing)}")

    asn_text = fields["Autonomous system number"].upper().removeprefix("AS").strip()
    if not asn_text.isdecimal():
        raise ValueError("Autonomous system number must be numeric")
    asn = int(asn_text)
    if not 1 <= asn <= 4_294_967_294 or 64_496 <= asn <= 65_535 or 4_200_000_000 <= asn <= 4_294_967_294:
        raise ValueError("Autonomous system number must be a public ASN")

    max_prefixes_text = fields["Maximum IPv6 prefixes"].strip()
    if not max_prefixes_text.isdecimal() or not 1 <= int(max_prefixes_text) <= 10_000:
        raise ValueError("Maximum IPv6 prefixes must be between 1 and 10000")

    prefix_tokens = re.split(r"[\s,]+", fields["IPv6 prefixes"].strip())
    prefixes = []
    for token in prefix_tokens:
        try:
            prefix = ipaddress.ip_network(token, strict=True)
        except ValueError as error:
            raise ValueError(f"Invalid prefix: {token}") from error
        if prefix.version != 6 or not prefix.is_global or not prefix.subnet_of(PUBLIC_SPACE) or prefix.prefixlen > 48:
            raise ValueError(f"Prefix must be global IPv6 and /48 or shorter: {prefix}")
        if prefix.overlaps(OWN_PREFIX):
            raise ValueError(f"Requester prefix overlaps AS218822 space: {prefix}")
        prefixes.append(prefix)
    prefixes = sorted(set(prefixes), key=lambda prefix: (int(prefix.network_address), prefix.prefixlen))
    if len(prefixes) > int(max_prefixes_text):
        raise ValueError("Listed prefixes exceed the maximum-prefix value")

    number = int(issue["number"])
    if not 1 <= number <= 4_294_967_295:
        raise ValueError("Issue number cannot be represented in the tunnel address")
    return {
        "number": number,
        "author": issue["user"]["login"],
        "network": fields["Network name"].strip(),
        "asn": asn,
        "prefixes": prefixes,
        "max_prefixes": int(max_prefixes_text),
    }


def tunnel_details(number):
    high, low = divmod(number, 65_536)
    base = ipaddress.ip_network(f"fd00:218:822:fffe:{high:x}:{low:x}::/127")
    return f"gh{number}", base[0], base[1]


def allocate_port(tunnel_directory, number):
    used = set()
    for path in tunnel_directory.glob("gh*.conf"):
        match = re.search(r"^ListenPort\s*=\s*(\d+)\s*$", path.read_text(), re.MULTILINE)
        if match:
            used.add(int(match.group(1)))
    start = 52_000 + number % 1_000
    for offset in range(1_000):
        port = 52_000 + (start - 52_000 + offset) % 1_000
        if port not in used:
            return port
    raise ValueError("No automated peering WireGuard ports remain")


def accept(root, request, client_public_key, endpoint):
    if not re.fullmatch(r"[A-Za-z0-9+/]{43}=", client_public_key):
        raise ValueError("Generated WireGuard public key is invalid")

    interface, local_address, remote_address = tunnel_details(request["number"])
    tunnel_directory = root / "routing/edge/gre-gateway/tunnels/wireguard"
    bird_directory = root / "routing/edge/gre-gateway/bird/peers"
    tunnel_path = tunnel_directory / f"{interface}.conf"
    bird_path = bird_directory / f"{interface}.conf"
    if tunnel_path.exists() or bird_path.exists():
        raise ValueError(f"Issue #{request['number']} has already been accepted")
    port = allocate_port(tunnel_directory, request["number"])

    allowed = [f"{remote_address}/128", *(str(prefix) for prefix in request["prefixes"])]
    tunnel_path.write_text(
        "[Interface]\n"
        f"Address = {local_address}/127\n"
        f"ListenPort = {port}\n"
        "PrivateKey = ${WG_GRE_GATEWAY_PRIVATE_KEY}\n"
        "Table = off\n"
        "MTU = 1420\n\n"
        "[Peer]\n"
        f"PublicKey = {client_public_key}\n"
        f"AllowedIPs = {', '.join(allowed)}\n"
    )

    bird_prefixes = ", ".join(str(prefix) for prefix in request["prefixes"])
    bird_path.write_text(
        f"protocol bgp github_{request['number']}_v6 from route_server_v6 {{\n"
        f"    neighbor {remote_address} as {request['asn']};\n"
        f"    source address {local_address};\n"
        "    enforce first as on;\n\n"
        "    ipv6 {\n"
        "        import filter {\n"
        "            if !valid_public_v6() then reject;\n"
        f"            if bgp_path !~ [= {request['asn']}+ =] then reject;\n"
        f"            if net !~ [{bird_prefixes}] then reject;\n"
        "            accept;\n"
        "        };\n"
        f"        receive limit {request['max_prefixes']} action disable;\n"
        f"        import limit {request['max_prefixes']} action disable;\n"
        "    };\n"
        "}\n"
    )

    nft_path = root / "routing/edge/gre-gateway/bird/source-validation.nft"
    nft = nft_path.read_text()
    marker = "        # PEERING_AUTOMATION_INSERT\n"
    if marker not in nft:
        raise ValueError(f"Missing insertion marker in {nft_path}")
    source_prefixes = ", ".join(str(prefix) for prefix in request["prefixes"])
    rules = (
        f"        iifname \"{interface}\" ip6 saddr {remote_address} ip6 daddr {local_address} return\n"
        f"        iifname \"{interface}\" ip6 saddr {{ {source_prefixes} }} ip6 daddr {OWN_PREFIX} return\n"
        f"        iifname \"{interface}\" counter name ingress_spoof drop\n"
    )
    nft_path.write_text(nft.replace(marker, rules + marker))

    return {
        "interface": interface,
        "port": port,
        "local_address": str(local_address),
        "remote_address": str(remote_address),
        "client_config": (
            "[Interface]\n"
            "PrivateKey = CLIENT_PRIVATE_KEY\n"
            f"Address = {remote_address}/127\n"
            "MTU = 1420\n\n"
            "[Peer]\n"
            f"PublicKey = {SERVER_PUBLIC_KEY}\n"
            f"Endpoint = {endpoint}:{port}\n"
            f"AllowedIPs = {local_address}/128, {OWN_PREFIX}\n"
            "PersistentKeepalive = 25\n"
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", type=Path, required=True)
    parser.add_argument("--client-public-key", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output-client", type=Path, required=True)
    args = parser.parse_args()

    request = parse_request(json.loads(args.event.read_text()))
    result = accept(args.root, request, args.client_public_key, args.endpoint)
    args.output_client.write_text(result.pop("client_config"))
    print(json.dumps({**request, **result}, default=str))


if __name__ == "__main__":
    main()
