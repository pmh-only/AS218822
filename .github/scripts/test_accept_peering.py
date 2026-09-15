import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("accept-peering.py")
SPEC = importlib.util.spec_from_file_location("accept_peering", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AcceptPeeringTest(unittest.TestCase):
    def request(self, prefixes="2001:4860::/32"):
        body = f"""### Autonomous system number

15169

### Network name

Example Network

### IPv6 prefixes

{prefixes}

### Maximum IPv6 prefixes

10

### PeeringDB profile

https://www.peeringdb.com/net/433
"""
        return MODULE.parse_request({"issue": {"number": 42, "body": body, "user": {"login": "example"}}})

    def test_parse_request(self):
        request = self.request("2001:4860::/32\n2607:f8b0::/32")
        self.assertEqual(request["asn"], 15169)
        self.assertEqual(len(request["prefixes"]), 2)

    def test_rejects_non_public_prefix(self):
        with self.assertRaisesRegex(ValueError, "global IPv6"):
            self.request("fd00::/48")

    def test_writes_wireguard_bird_and_nft_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tunnel = root / "routing/edge/gre-gateway/tunnels/wireguard"
            bird = root / "routing/edge/gre-gateway/bird/peers"
            tunnel.mkdir(parents=True)
            bird.mkdir(parents=True)
            nft = bird.parent / "source-validation.nft"
            nft.write_text("chain github_peers {\n        # PEERING_AUTOMATION_INSERT\n}\n")

            result = MODULE.accept(
                root,
                self.request(),
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                "198.51.100.1",
            )

            self.assertIn("ListenPort = 52042", (tunnel / "gh42.conf").read_text())
            self.assertIn("neighbor fd00:218:822:fffe:0:2a:0:1 as 15169", (bird / "gh42.conf").read_text())
            self.assertIn('iifname "gh42"', nft.read_text())
            self.assertIn("Endpoint = 198.51.100.1:52042", result["client_config"])


if __name__ == "__main__":
    unittest.main()
