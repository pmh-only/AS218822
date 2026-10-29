#!/usr/bin/perl
use strict;
use warnings;
use Socket qw(AF_INET SOCK_STREAM SOL_SOCKET SHUT_WR getaddrinfo);
use IO::Select;
use Fcntl qw(F_GETFL F_SETFL O_NONBLOCK);
use Errno qw(EAGAIN EWOULDBLOCK EINTR);

# Only Atlas's SSH control connection uses the underlay. Ordinary probe
# measurements remain subject to the pod's fail-closed routing policy.
@ARGV == 2 && $ARGV[1] eq '443' or die "Expected control host and port 443\n";
my ($error, @addresses) = getaddrinfo($ARGV[0], $ARGV[1], {
    family => AF_INET, socktype => SOCK_STREAM,
});
die "Cannot resolve control host: $error\n" if $error;

my $socket;
{
    local $SIG{ALRM} = sub { die "Control connection timed out\n" };
    alarm 15;
    for my $address (@addresses) {
        socket(my $candidate, AF_INET, SOCK_STREAM, $address->{protocol}) or die "socket: $!\n";
        # The existing Tailscale transport rule sends this socket via main,
        # before both Tailscale's exit route and the IPv4 unreachable rule.
        # Linux permits SO_MARK with the probe's existing CAP_NET_RAW.
        setsockopt($candidate, SOL_SOCKET, 36, pack('I', 0x80000)) or die "SO_MARK: $!\n";
        if (connect($candidate, $address->{addr})) {
            $socket = $candidate;
            last;
        }
    }
    alarm 0;
}
die "Cannot connect to control host\n" unless $socket;

binmode STDIN;
binmode STDOUT;
for my $handle (\*STDIN, \*STDOUT, $socket) {
    my $flags = fcntl($handle, F_GETFL, 0);
    defined($flags) && defined(fcntl($handle, F_SETFL, $flags | O_NONBLOCK))
        or die "nonblocking IO: $!\n";
}
$SIG{PIPE} = 'IGNORE';
my ($input_open, $remote_open, $shutdown) = (1, 1, 0);
my ($outbound, $inbound) = ('', '');
while ($remote_open || length($inbound)) {
    if (!$input_open && !length($outbound) && !$shutdown) {
        shutdown($socket, SHUT_WR);
        $shutdown = 1;
    }
    my $read = IO::Select->new;
    my $write = IO::Select->new;
    $read->add(\*STDIN) if $input_open && $remote_open && length($outbound) < 262144;
    $read->add($socket) if $remote_open && length($inbound) < 262144;
    $write->add($socket) if $remote_open && length($outbound);
    $write->add(\*STDOUT) if length($inbound);
    my ($readable, $writable) = IO::Select->select($read, $write, undef);
    next unless $readable;
    for my $handle (@$readable) {
        my $count = sysread($handle, my $buffer, 65536);
        if (!defined($count)) {
            next if $! == EAGAIN || $! == EWOULDBLOCK || $! == EINTR;
            die "read: $!\n";
        }
        if (fileno($handle) == fileno(STDIN)) {
            $input_open = 0 unless $count;
            $outbound .= $buffer;
        } else {
            $remote_open = 0 unless $count;
            $inbound .= $buffer;
        }
    }
    for my $handle (@$writable) {
        my $buffer = fileno($handle) == fileno($socket) ? \$outbound : \$inbound;
        my $count = syswrite($handle, $$buffer);
        if (!defined($count)) {
            next if $! == EAGAIN || $! == EWOULDBLOCK || $! == EINTR;
            die "write: $!\n";
        }
        substr($$buffer, 0, $count, '');
    }
}
