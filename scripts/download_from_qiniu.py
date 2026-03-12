#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download latest backup files from Qiniu cloud storage.

Usage: python3 download_from_qiniu.py [--type mysql|minio|all]

Downloads the latest MySQL .sql and/or MinIO .tar.gz backup files
from Qiniu cloud storage to /backups/ directory.

Environment variables:
  QINIU_ACCESS_KEY  - Qiniu Access Key (required)
  QINIU_SECRET_KEY  - Qiniu Secret Key (required)
  QINIU_BUCKET      - Qiniu bucket name (required)
  QINIU_KEY_PREFIX  - Object key prefix (optional, default: "menzhen-backup/")
  QINIU_DOMAIN      - Qiniu download domain (optional, default: "public.qnlinking.com")
  BACKUP_DIR        - Local backup directory (optional, default: "/backups")
"""

import os
import sys
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
    urllib.request.urlretrieve(url, local_path)
    size = os.path.getsize(local_path)
    print(f"Downloaded: {local_path} ({size} bytes)")
    return True


def make_download_url(auth, domain, key, use_https=True):
    """Generate a private download URL with token."""
    scheme = "https" if use_https else "http"
    base_url = f"{scheme}://{domain}/{key}"
    return auth.private_download_url(base_url, expires=3600)


def main():
    # Parse args
    download_type = "all"
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--type" and i + 1 < len(sys.argv):
            download_type = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    if download_type not in ("mysql", "minio", "all"):
        print("Usage: download_from_qiniu.py [--type mysql|minio|all]", file=sys.stderr)
        sys.exit(1)

    access_key = os.environ.get("QINIU_ACCESS_KEY", "")
    secret_key = os.environ.get("QINIU_SECRET_KEY", "")
    bucket_name = os.environ.get("QINIU_BUCKET", "")
    key_prefix = os.environ.get("QINIU_KEY_PREFIX", "menzhen-backup/")
    domain = os.environ.get("QINIU_DOMAIN", "public.qnlinking.com")
    backup_dir = os.environ.get("BACKUP_DIR", "/backups")

    if not access_key or not secret_key or not bucket_name:
        print("Error: QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET must be set", file=sys.stderr)
        sys.exit(1)

    auth = Auth(access_key, secret_key)
    bucket_mgr = BucketManager(auth)

    downloaded = {"mysql": None, "minio": None}

    # --- Download latest MySQL backup ---
    if download_type in ("mysql", "all"):
        print(">> Looking for latest MySQL backup...")
        items = list_files(bucket_mgr, bucket_name, prefix=key_prefix)
        # Filter: direct children .sql files (not in minio/ subfolder)
        sql_files = [
            item for item in items
            if item["key"].endswith(".sql")
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
        print(">> Looking for latest MinIO backup...")
        minio_prefix = f"{key_prefix}minio/"
        items = list_files(bucket_mgr, bucket_name, prefix=minio_prefix)
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

    print("Done. Run 'restore.sh --auto' to restore.")


if __name__ == "__main__":
    main()
