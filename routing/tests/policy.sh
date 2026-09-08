#!/bin/sh
set -eu
bird -f -c /tests/policy.conf -s /run/bird/test.ctl &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
attempts=0
until birdc -s /run/bird/test.ctl show status >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 50 ] || exit 1
    sleep 0.1
done
sleep 1
routes=$(birdc -s /run/bird/test.ctl 'show route where valid_public_v6()')
printf '%s\n' "$routes"
printf '%s\n' "$routes" | grep -q '2606:4700::/32'
printf '%s\n' "$routes" | grep -q '2001:4860::/32'
count=$(printf '%s\n' "$routes" | grep -c blackhole)
[ "$count" -eq 2 ]

routes=$(birdc -s /run/bird/test.ctl 'show route table customer6 where valid_lunalight_v6()')
printf '%s\n' "$routes"
printf '%s\n' "$routes" | grep -q '2a0f:6284:b::/48'
printf '%s\n' "$routes" | grep -q '2a0f:6284:c::/48'
count=$(printf '%s\n' "$routes" | grep -c blackhole)
[ "$count" -eq 2 ]

# With the authorized ROAs gone, b is NotFound and c is Invalid; reject both.
birdc -s /run/bird/test.ctl disable customer_roas
routes=$(birdc -s /run/bird/test.ctl 'show route table customer6 where valid_lunalight_v6()')
if printf '%s\n' "$routes" | grep -q blackhole; then
    echo 'Customer routes accepted without a valid ROA' >&2
    exit 1
fi
birdc -s /run/bird/test.ctl enable customer_roas
routes=$(birdc -s /run/bird/test.ctl 'show route table customer6 where valid_lunalight_v6()')
count=$(printf '%s\n' "$routes" | grep -c blackhole)
[ "$count" -eq 2 ]
