#!/usr/bin/env python3
"""Private JSON bridge from dpuAgent to the supported NVFlare FLARE API."""

import json
import sys


def fail(message):
    print(json.dumps({"ok": False, "error": str(message)}))
    raise SystemExit(1)


def session_for(credential):
    try:
        import nvflare
        from nvflare.fuel.flare_api.flare_api import new_secure_session
    except Exception as error:
        fail(f"NVFlare 2.8.1 is unavailable: {error.__class__.__name__}")
    username = str(credential.get("username", "")).strip()
    startup_kit = str(credential.get("startupKitPath", "")).strip()
    study = str(credential.get("study", "default")).strip() or "default"
    if not username or not startup_kit:
        fail("NVFlare username and startup kit are required.")
    try:
        session = new_secure_session(username, startup_kit_location=startup_kit, study=study)
    except TypeError:
        session = new_secure_session(username, startup_kit_location=startup_kit)
    return session, str(getattr(nvflare, "__version__", ""))


def main():
    try:
        payload = json.load(sys.stdin)
        operation = str(payload.get("operation", ""))
        session, version = session_for(payload.get("credential") or {})
        if operation == "test":
            session.list_jobs()
            result = {"ok": True, "identity": payload["credential"]["username"], "version": version}
        elif operation == "submit":
            job_id = session.submit_job(str(payload.get("jobPath", "")))
            result = {"ok": True, "externalJobId": str(job_id), "state": "RUNNING", "version": version}
        elif operation == "get":
            job_id = str(payload.get("externalJobId", ""))
            jobs = session.list_jobs(detailed=True, all=True)
            job = next((item for item in jobs if str(item.get("job_id", "")) == job_id), None)
            if job is None:
                fail("NVFlare job was not found.")
            result = {"ok": True, "externalJobId": job_id, "state": str(job.get("status", "UNKNOWN")), "job": job}
        elif operation == "cancel":
            job_id = str(payload.get("externalJobId", ""))
            session.abort_job(job_id)
            result = {"ok": True, "externalJobId": job_id, "state": "CANCELLED"}
        else:
            fail("Unsupported NVFlare bridge operation.")
        print(json.dumps(result))
    except SystemExit:
        raise
    except Exception as error:
        fail(f"NVFlare operation failed: {error.__class__.__name__}")


if __name__ == "__main__":
    main()
