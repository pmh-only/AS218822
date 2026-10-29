#!/usr/bin/perl
use strict;
use warnings;
use Socket qw(AF_INET SOCK_STREAM SOL_SOCKET SO_REUSEADDR sockaddr_in inet_aton);
use IPC::Open3;
use POSIX qw(_exit);

local $SIG{ALRM} = sub { die "Control proxy test timed out\n" };
alarm 20;
socket(my $listener, AF_INET, SOCK_STREAM, 6) or die $!;
setsockopt($listener, SOL_SOCKET, SO_REUSEADDR, pack('I', 1)) or die $!;
bind($listener, sockaddr_in(443, inet_aton('127.0.0.1'))) or die $!;
listen($listener, 1) or die $!;
my $server = fork();
defined $server or die $!;
if (!$server) {
    accept(my $client, $listener) or die $!;
    close $listener;
    while (my $count = sysread($client, my $data, 32768)) {
        while (length $data) {
            my $written = syswrite($client, $data);
            defined($written) && $written > 0 or die $!;
            substr($data, 0, $written, '');
        }
    }
    print {$client} "EOF-ACK\n";
    close $client;
    _exit(0);
}
close $listener;
my $proxy = open3(my $input, my $output, '>&STDERR',
    'setpriv', '--reuid=ripe-atlas', '--regid=ripe-atlas', '--init-groups',
    '--inh-caps=+net_raw', '--ambient-caps=+net_raw', '--',
    '/usr/local/bin/atlas-control-proxy', '127.0.0.1', '443');
my $payload = "Atlas\0control\xff\n" x 100000;
my $writer = fork();
defined $writer or die $!;
if (!$writer) {
    binmode $input;
    print {$input} $payload or die $!;
    close $input or die $!;
    _exit(0);
}
close $input;
binmode $output;
my $received = do { local $/; <$output> };
close $output;
for my $pid ($writer, $proxy, $server) {
    waitpid($pid, 0);
    $? == 0 or die "Child $pid failed: $?\n";
}
die "Binary stream or half-close response corrupted\n" unless $received eq $payload . "EOF-ACK\n";
system('/usr/local/bin/atlas-control-proxy', '127.0.0.1', '22') != 0
    or die "Proxy unexpectedly accepted a non-control port\n";
alarm 0;
print "Control proxy: unprivileged marked connection, binary relay, backpressure, half-close and port restriction passed\n";
