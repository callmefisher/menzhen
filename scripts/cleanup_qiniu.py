#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Clean up old backup files on Qiniu cloud storage, keeping only the latest N.

Usage: python3 cleanup_qiniu.py --type mysql|minio

Environment variables:
  QINIU_ACCESS_KEY    - Qiniu Access Key (required)
  QINIU_SECRET_KEY    - Qiniu Secret Key (required)
  QINIU_BUCKET        - Qiniu bucket name (required)
  QINIU_KEY_PREFIX    - Object key prefix (optional, default: "menzhen-backup/")
  QINIU_RETAIN_MYSQL  - Number of MySQL backups to keep (optional, default: 5)
  QINIU_RETAIN_MINIO  - Number of MinIO backups to keep (optional, default: 5)
"""

import os
import sys

from qiniu import Auth, BucketManager


def list_files(bucket_mgr, bucket_name, prefix, limit=1000):
    """List files in Qiniu bucket with given prefix, sorted by key descending."""
    ret, eof, info = bucket_mgr.list(bucket_name, prefix=prefix, limit=limit)
    if ret is None:
        print(f"Error listing files with prefix '{prefix}': {info}", file=sys.stderr)
        return []
    items = ret.get("items", [])
    items.sort(key=lambda x: x.get("key", ""), reverse=True)
    return items


def cleanup(bucket_mgr, bucket_name, prefix, suffix, retain_count, label):
    """List files matching prefix+suffix, delete all but the latest retain_count."""
    items = list_files(bucket_mgr, bucket_name, prefix)

    # Filter by suffix
    matched = [item for item in items if item["key"].endswith(suffix)]

    total = len(matched)
    if total <= retain_count:
        print(f"[{label}] {total} file(s) on Qiniu, retain={retain_count}, nothing to delete")
        return

    to_delete = matched[retain_count:]
    print(f"[{label}] {total} file(s) on Qiniu, retain={retain_count}, deleting {len(to_delete)} old file(s)...")

    for item in to_delete:
        key = item["key"]
        ret, info = bucket_mgr.delete(bucket_name, key)
        if info.status_code == 200:
            print(f"  Deleted: {key}")
        else:
            print(f"  WARNING: Failed to delete {key}: status={info.status_code}", file=sys.stderr)


def main():
    # Parse args
    cleanup_type = None
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--type" and i + 1 < len(sys.argv):
            cleanup_type = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    if cleanup_type not in ("mysql", "minio"):
        print("Usage: cleanup_qiniu.py --type mysql|minio", file=sys.stderr)
        sys.exit(1)

    access_key = os.environ.get("QINIU_ACCESS_KEY", "")
    secret_key = os.environ.get("QINIU_SECRET_KEY", "")
    bucket_name = os.environ.get("QINIU_BUCKET", "")
    key_prefix = os.environ.get("QINIU_KEY_PREFIX", "menzhen-backup/")

    if not access_key or not secret_key or not bucket_name:
        print("Error: QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET must be set", file=sys.stderr)
        sys.exit(1)

    auth = Auth(access_key, secret_key)
    bucket_mgr = BucketManager(auth)

    if cleanup_type == "mysql":
        retain = int(os.environ.get("QINIU_RETAIN_MYSQL", "5"))
        # MySQL backups are direct children: {prefix}YYYYMMDD_HHMMSS.sql
        # Filter out minio/ subfolder items by checking no extra '/' after prefix
        items = list_files(bucket_mgr, bucket_name, key_prefix)
        matched = [
            item for item in items
            if item["key"].endswith(".sql")
            and "/" not in item["key"][len(key_prefix):]
        ]
        total = len(matched)
        if total <= retain:
            print(f"[MySQL] {total} file(s) on Qiniu, retain={retain}, nothing to delete")
        else:
            to_delete = matched[retain:]
            print(f"[MySQL] {total} file(s) on Qiniu, retain={retain}, deleting {len(to_delete)} old file(s)...")
            for item in to_delete:
                key = item["key"]
                ret, info = bucket_mgr.delete(bucket_name, key)
                if info.status_code == 200:
                    print(f"  Deleted: {key}")
                else:
                    print(f"  WARNING: Failed to delete {key}: status={info.status_code}", file=sys.stderr)

    elif cleanup_type == "minio":
        retain = int(os.environ.get("QINIU_RETAIN_MINIO", "5"))
        minio_prefix = f"{key_prefix}minio/"
        cleanup(bucket_mgr, bucket_name, minio_prefix, ".tar.gz", retain, "MinIO")


if __name__ == "__main__":
    main()
