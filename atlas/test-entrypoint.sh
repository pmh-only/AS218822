#!/bin/sh
set -eu

# Run the real bootstrap in a disposable container without network access.
timeout -k 1 3 /usr/local/bin/entrypoint.sh >/dev/null 2>&1 || [ "$?" -eq 124 ]
. /etc/ripe-atlas/reg_servers.sh
case "${SSH_ADDRESS_FAMILY:-inet}" in
    inet)
        [ "$REG_3_HOST" = "$REG_1_HOST" ]
        [ "$REG_6_HOST" = "$REG_4_HOST" ]
        ;;
    inet6)
        [ "$REG_2_HOST" = "$REG_1_HOST" ]
        [ "$REG_5_HOST" = "$REG_4_HOST" ]
        grep -q '^    AddressFamily any$' /etc/ssh/ssh_config.d/ripe-atlas.conf
        ;;
    any)
        [ "$REG_2_HOST" = 193.0.19.75 ]
        [ "$REG_3_HOST" = 2001:67c:2e8:11::c100:134b ]
        ;;
esac
test -s /etc/ripe-atlas/probe_key.pub
if [ "${SSH_CONTROL_UNDERLAY:-0}" = 1 ]; then
    ssh -G reg-05.prod.atlas.ripe.net 2>/dev/null | grep -q '^proxycommand /usr/local/bin/atlas-control-proxy %h %p$'
    if ssh -G 127.0.0.1 2>/dev/null | grep -q '^proxycommand /usr/local/bin/atlas-control-proxy'; then
        echo 'Local reverse-tunnel connections must not use the control proxy' >&2
        exit 1
    fi
fi
if [ "${SSH_CONTROL_UNDERLAY:-0}" = registration ]; then
    [ "$REG_3_HOST" = "$REG_1_HOST" ]
    [ "$REG_6_HOST" = "$REG_4_HOST" ]
    for host in "$REG_1_HOST" "$REG_4_HOST" 193.0.19.75 193.0.19.76; do
        ssh -G "$host" 2>/dev/null | grep -q '^addressfamily inet$'
        ssh -G "$host" 2>/dev/null | grep -q '^proxycommand /usr/local/bin/atlas-control-proxy %h %p$'
    done
    for host in ctr-dub-sw01.atlas.prod.ripe.net 2a13:27c0:1c:d00:26d6:fe95:acb7:2e9a; do
        ssh -G "$host" 2>/dev/null | grep -q '^addressfamily inet6$'
        if ssh -G "$host" 2>/dev/null | grep -q '^proxycommand /usr/local/bin/atlas-control-proxy'; then
            echo 'Controller must use native IPv6, not the OCI control proxy' >&2
            exit 1
        fi
    done
    ssh -G 127.0.0.1 2>/dev/null | grep -q '^addressfamily any$'
fi
printf 'Atlas bootstrap passed for %s\n' "${SSH_ADDRESS_FAMILY:-inet}"
