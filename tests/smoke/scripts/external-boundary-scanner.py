#!/usr/bin/env python3

import asyncio
import errno
import json
import os
import socket
import struct
import urllib.request
from datetime import datetime, timezone

SCAN_CONFIG = __SCAN_CONFIG__
STUN_MAGIC_COOKIE = 0x2112A442
STUN_BINDING_REQUEST = 0x0001
STUN_BINDING_SUCCESS = 0x0101
STUN_BINDING_ERROR = 0x0111


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_egress_ipv4(url):
    request = urllib.request.Request(url, headers={"accept": "application/json, text/plain"})
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read(4096).decode("utf-8").strip()
    try:
        payload = json.loads(body)
        return str(payload.get("ip") or payload.get("address") or "").strip()
    except json.JSONDecodeError:
        return body


async def scan_tcp_port(target, port, semaphore, timeout_seconds):
    async with semaphore:
        writer = None
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(target, port, family=socket.AF_INET),
                timeout=timeout_seconds,
            )
            return port
        except asyncio.TimeoutError:
            return None
        except OSError as error:
            if error.errno in {errno.ECONNREFUSED, errno.ECONNRESET, errno.ETIMEDOUT}:
                return None
            raise RuntimeError(
                f"tcp scan could not classify port {port}: local socket errno {error.errno}"
            ) from error
        finally:
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except (ConnectionError, OSError):
                    pass


async def scan_all_tcp(target, concurrency, timeout_seconds):
    semaphore = asyncio.Semaphore(concurrency)
    tasks = [scan_tcp_port(target, port, semaphore, timeout_seconds) for port in range(1, 65536)]
    results = await asyncio.gather(*tasks)
    return [port for port in results if port is not None]


def stun_username_attribute(username):
    value = username.encode("utf-8")
    padding = b"\x00" * ((4 - (len(value) % 4)) % 4)
    return struct.pack("!HH", 0x0006, len(value)) + value + padding


async def invalid_ice_probe(target, scan_id):
    transaction_id = os.urandom(12)
    username = f"invalid:{scan_id[:24]}"
    attributes = stun_username_attribute(username)
    packet = struct.pack("!HHI12s", STUN_BINDING_REQUEST, len(attributes), STUN_MAGIC_COOKIE, transaction_id) + attributes
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setblocking(False)
    try:
        await loop.sock_sendto(sock, packet, (target, 7882))
        try:
            response, _ = await asyncio.wait_for(loop.sock_recvfrom(sock, 2048), timeout=2.0)
        except asyncio.TimeoutError:
            return {
                "protocol": "udp",
                "targetPort": 7882,
                "requestHadMessageIntegrity": False,
                "outcome": "timeout",
                "successResponse": False,
                "responseType": None,
            }
        if len(response) < 20:
            raise RuntimeError("invalid ICE probe received a malformed STUN response")
        message_type, _, cookie, response_transaction_id = struct.unpack("!HHI12s", response[:20])
        if cookie != STUN_MAGIC_COOKIE or response_transaction_id != transaction_id:
            raise RuntimeError("invalid ICE probe received an unrelated STUN response")
        if message_type not in (STUN_BINDING_SUCCESS, STUN_BINDING_ERROR):
            raise RuntimeError("invalid ICE probe received an unexpected STUN message type")
        return {
            "protocol": "udp",
            "targetPort": 7882,
            "requestHadMessageIntegrity": False,
            "outcome": "success-response" if message_type == STUN_BINDING_SUCCESS else "error-response",
            "successResponse": message_type == STUN_BINDING_SUCCESS,
            "responseType": message_type,
        }
    finally:
        sock.close()


async def main():
    config = SCAN_CONFIG
    started_at = iso_now()
    egress_ipv4 = await asyncio.to_thread(read_egress_ipv4, config["echoUrl"])
    if egress_ipv4 != config["expectedEgressIPv4"]:
        raise RuntimeError("scanner egress IPv4 does not match the configured external network")
    open_ports, ice_probe = await asyncio.gather(
        scan_all_tcp(config["targetPublicIPv4"], config["concurrency"], config["connectTimeoutSeconds"]),
        invalid_ice_probe(config["targetPublicIPv4"], config["scanId"]),
    )
    result = {
        "scanner": "ploinky-external-boundary",
        "scannerSourceSha256": config["scannerSourceSha256"],
        "scanId": config["scanId"],
        "targetPublicIPv4": config["targetPublicIPv4"],
        "egressIPv4": egress_ipv4,
        "scanStart": 1,
        "scanEnd": 65535,
        "openPorts": open_ports,
        "startedAt": started_at,
        "observedAt": iso_now(),
        "invalidIceProbe": ice_probe,
    }
    print(json.dumps(result, separators=(",", ":"), sort_keys=True), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
