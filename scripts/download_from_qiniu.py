#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download backup files from Qiniu cloud storage.

Usage:
  python3 download_from_qiniu.py [--type mysql|minio|all]
  python3 download_from_qiniu.py --action list [--type mysql|minio|all]
  python3 download_from_qiniu.py --mysql-file <name> [--minio-file <name>]

Downloads MySQL .sql and/or MinIO .tar.gz backup files
from Qiniu cloud storage to /backups/ directory.

With --action list, outputs JSON file list without downloading.
With --mysql-file / --minio-file, downloads the specific named files.

Environment variables:
  QINIU_ACCESS_KEY  - Qiniu Access Key (required)
  QINIU_SECRET_KEY  - Qiniu Secret Key (required)
  QINIU_BUCKET      - Qiniu bucket name (required)
  QINIU_KEY_PREFIX  - Object key prefix (optional, default: "menzhen-backup/")
  QINIU_DOMAIN      - Qiniu download domain (optional, default: "public.qnlinking.com")
  BACKUP_DIR        - Local backup directory (optional, default: "/backups")
"""

import os
import json
import re
import sys
import urllib.error
import urllib.request

from qiniu import Auth, BucketManager


def list_files(bucket_mgr, bucket_name, prefix, limit=100):
    """List files in Qiniu bucket with given prefix, sorted by name descending."""
    ret, eof, info = bucket_mgr.list(bucket_name, prefix=prefix, limit=limit)
    if ret is None:
        print(f"Error listing files with prefix '{prefix}': {info}", file=sys.stderr)
        return []
    items = ret.get("items", [])
    # Sort by key descending (timestamp in filename = latest first)
    items.sort(key=lambda x: x.get("key", ""), reverse=True)
    return items


def download_file(url, local_path):
    """Download a file from URL to local path."""
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    print(f"Downloading {url} -> {local_path} ...")
    try:
        urllib.request.urlretrieve(url, local_path)
    except urllib.error.HTTPError as e:
        print(f"HTTP error downloading {local_path}: {e.code} {e.reason}", file=sys.stderr)
        return False
    except urllib.error.URLError as e:
        print(f"URL error downloading {local_path}: {e.reason}", file=sys.stderr)
        return False
    size = os.path.getsize(local_path)
    print(f"Downloaded: {local_path} ({size} bytes)")
    return True


def make_download_url(auth, domain, key, use_https=True):
    """Generate a private download URL with token."""
    scheme = "https" if use_https else "http"
    base_url = f"{scheme}://{domain}/{key}"
    return auth.private_download_url(base_url, expires=3600)


def list_files_json(bucket_mgr, bucket_name, key_prefix, site_id, download_type):
    """List backup files and output as JSON for API consumption."""
    results = {"mysql": [], "minio": []}

    if download_type in ("mysql", "all"):
        # Try SITE_ID-scoped prefix first
        site_prefix = f"{key_prefix}{site_id}/"
        items = list_files(bucket_mgr, bucket_name, prefix=site_prefix)
        sql_files = [
            item for item in items
            if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
            and "/" not in item["key"][len(site_prefix):]
        ]
        # Fallback to legacy prefix
        if not sql_files:
            items = list_files(bucket_mgr, bucket_name, prefix=key_prefix)
            sql_files = [
                item for item in items
                if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
                and "/" not in item["key"][len(key_prefix):]
            ]
        for item in sql_files:
            results["mysql"].append({
                "filename": os.path.basename(item["key"]),
                "key": item["key"],
                "size": item.get("fsize", 0),
                "modified": item.get("putTime", 0) // 10000000,
            })

    if download_type in ("minio", "all"):
        # Try SITE_ID-scoped prefix first
        minio_prefix = f"{key_prefix}{site_id}/minio/"
        items = list_files(bucket_mgr, bucket_name, prefix=minio_prefix)
        tar_files = [item for item in items if item["key"].endswith(".tar.gz")]
        # Fallback to legacy prefix
        if not tar_files:
            legacy_minio_prefix = f"{key_prefix}minio/"
            items = list_files(bucket_mgr, bucket_name, prefix=legacy_minio_prefix)
            tar_files = [item for item in items if item["key"].endswith(".tar.gz")]
        for item in tar_files:
            results["minio"].append({
                "filename": os.path.basename(item["key"]),
                "key": item["key"],
                "size": item.get("fsize", 0),
                "modified": item.get("putTime", 0) // 10000000,
            })

    print(json.dumps(results))


def find_and_download_file(bucket_mgr, auth, bucket_name, key_prefix, site_id, domain, target_filename, is_minio=False):
    """Find a specific file by filename in the cloud and download it."""
    if is_minio:
        prefixes = [f"{key_prefix}{site_id}/minio/", f"{key_prefix}minio/"]
    else:
        prefixes = [f"{key_prefix}{site_id}/", key_prefix]

    for prefix in prefixes:
        items = list_files(bucket_mgr, bucket_name, prefix=prefix)
        for item in items:
            if os.path.basename(item["key"]) == target_filename:
                return item
    return None


def main():
    # Parse args
    download_type = "all"
    action = "download"
    mysql_file = ""
    minio_file = ""
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--type" and i + 1 < len(sys.argv):
            download_type = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--action" and i + 1 < len(sys.argv):
            action = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--mysql-file" and i + 1 < len(sys.argv):
            mysql_file = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--minio-file" and i + 1 < len(sys.argv):
            minio_file = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    # If specific files are requested, use targeted download mode
    specific_mode = bool(mysql_file or minio_file)

    if not specific_mode:
        if download_type not in ("mysql", "minio", "all"):
            print("Usage: download_from_qiniu.py [--action download|list] [--type mysql|minio|all]", file=sys.stderr)
            sys.exit(1)
        if action not in ("download", "list"):
            print("Usage: download_from_qiniu.py [--action download|list] [--type mysql|minio|all]", file=sys.stderr)
            sys.exit(1)

    access_key = os.environ.get("QINIU_ACCESS_KEY", "")
    secret_key = os.environ.get("QINIU_SECRET_KEY", "")
    bucket_name = os.environ.get("QINIU_BUCKET", "")
    key_prefix = os.environ.get("QINIU_KEY_PREFIX", "menzhen-backup/")
    site_id = os.environ.get("SITE_ID", "default")
    domain = os.environ.get("QINIU_DOMAIN", "public.qnlinking.com")
    backup_dir = os.environ.get("BACKUP_DIR", "/backups")

    if not re.match(r'^[A-Za-z0-9_-]+$', site_id):
        print(f"Error: SITE_ID contains invalid characters: {site_id}", file=sys.stderr)
        sys.exit(1)

    if not access_key or not secret_key or not bucket_name:
        print("Error: QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET must be set", file=sys.stderr)
        sys.exit(1)

    auth = Auth(access_key, secret_key)
    bucket_mgr = BucketManager(auth)

    # List mode: output JSON and exit
    if action == "list":
        list_files_json(bucket_mgr, bucket_name, key_prefix, site_id, download_type)
        sys.exit(0)

    downloaded = {"mysql": None, "minio": None}

    # --- Specific file download mode ---
    if specific_mode:
        if mysql_file:
            print(f">> Downloading specific MySQL file: {mysql_file}")
            local_path = os.path.join(backup_dir, mysql_file)
            if os.path.isfile(local_path):
                print(f"MySQL backup already exists locally: {local_path}, skipping download")
                downloaded["mysql"] = local_path
            else:
                item = find_and_download_file(bucket_mgr, auth, bucket_name, key_prefix, site_id, domain, mysql_file, is_minio=False)
                if item:
                    url = make_download_url(auth, domain, item["key"])
                    if download_file(url, local_path):
                        downloaded["mysql"] = local_path
                else:
                    print(f"Error: MySQL file '{mysql_file}' not found in cloud", file=sys.stderr)
                    sys.exit(1)

        if minio_file:
            print(f">> Downloading specific MinIO file: {minio_file}")
            local_path = os.path.join(backup_dir, "minio", minio_file)
            if os.path.isfile(local_path):
                print(f"MinIO backup already exists locally: {local_path}, skipping download")
                downloaded["minio"] = local_path
            else:
                item = find_and_download_file(bucket_mgr, auth, bucket_name, key_prefix, site_id, domain, minio_file, is_minio=True)
                if item:
                    url = make_download_url(auth, domain, item["key"])
                    if download_file(url, local_path):
                        downloaded["minio"] = local_path
                else:
                    print(f"Error: MinIO file '{minio_file}' not found in cloud", file=sys.stderr)
                    sys.exit(1)
    else:
        # --- Download latest MySQL backup ---
        if download_type in ("mysql", "all"):
            print(f">> Looking for latest MySQL backup (SITE_ID={site_id})...")
            # Try SITE_ID-scoped prefix first
            site_prefix = f"{key_prefix}{site_id}/"
            items = list_files(bucket_mgr, bucket_name, prefix=site_prefix)
            sql_files = [
                item for item in items
                if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
                and "/" not in item["key"][len(site_prefix):]
            ]
            # Fallback: try legacy prefix (no SITE_ID subdirectory)
            if not sql_files:
                print(f">> No MySQL backup in {site_prefix}, trying legacy prefix {key_prefix}...")
                items = list_files(bucket_mgr, bucket_name, prefix=key_prefix)
                sql_files = [
                    item for item in items
                    if (item["key"].endswith(".sql") or item["key"].endswith(".sql.gz"))
                    and "/" not in item["key"][len(key_prefix):]
                ]
            if sql_files:
                latest = sql_files[0]
                filename = os.path.basename(latest["key"])
                local_path = os.path.join(backup_dir, filename)
                if os.path.isfile(local_path):
                    print(f"MySQL backup already exists locally: {local_path}, skipping download")
                    downloaded["mysql"] = local_path
                else:
                    url = make_download_url(auth, domain, latest["key"])
                    if download_file(url, local_path):
                        downloaded["mysql"] = local_path
            else:
                print("No MySQL backup found on Qiniu")

        # --- Download latest MinIO backup ---
        if download_type in ("minio", "all"):
            print(f">> Looking for latest MinIO backup (SITE_ID={site_id})...")
            # Try SITE_ID-scoped prefix first
            minio_prefix = f"{key_prefix}{site_id}/minio/"
            items = list_files(bucket_mgr, bucket_name, prefix=minio_prefix)
            tar_files = [item for item in items if item["key"].endswith(".tar.gz")]
            # Fallback: try legacy prefix (no SITE_ID subdirectory)
            if not tar_files:
                legacy_minio_prefix = f"{key_prefix}minio/"
                print(f">> No MinIO backup in {minio_prefix}, trying legacy prefix {legacy_minio_prefix}...")
                items = list_files(bucket_mgr, bucket_name, prefix=legacy_minio_prefix)
                tar_files = [item for item in items if item["key"].endswith(".tar.gz")]
            if tar_files:
                latest = tar_files[0]
                filename = os.path.basename(latest["key"])
                local_path = os.path.join(backup_dir, "minio", filename)
                if os.path.isfile(local_path):
                    print(f"MinIO backup already exists locally: {local_path}, skipping download")
                    downloaded["minio"] = local_path
                else:
                    url = make_download_url(auth, domain, latest["key"])
                    if download_file(url, local_path):
                        downloaded["minio"] = local_path
            else:
                print("No MinIO backup found on Qiniu")

    # --- Summary ---
    print("\n== Download Summary ==")
    if downloaded["mysql"]:
        print(f"MySQL: {downloaded['mysql']}")
    if downloaded["minio"]:
        print(f"MinIO: {downloaded['minio']}")
    if not downloaded["mysql"] and not downloaded["minio"]:
        print("No files downloaded")
        sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
