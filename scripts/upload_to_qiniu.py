#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Upload backup file to Qiniu cloud storage.

Usage: python3 upload_to_qiniu.py <local_file_path>

Environment variables:
  QINIU_ACCESS_KEY  - Qiniu Access Key (required)
  QINIU_SECRET_KEY  - Qiniu Secret Key (required)
  QINIU_BUCKET      - Qiniu bucket name (required)
  QINIU_KEY_PREFIX  - Object key prefix (optional, default: "menzhen-backup/")
"""

import os
import sys

from qiniu import Auth, put_file_v2, etag


def main():
    if len(sys.argv) < 2:
        print("Usage: upload_to_qiniu.py <local_file_path>", file=sys.stderr)
        sys.exit(1)

    local_file = sys.argv[1]
    if not os.path.isfile(local_file):
        print(f"Error: file not found: {local_file}", file=sys.stderr)
        sys.exit(1)

    access_key = os.environ.get("QINIU_ACCESS_KEY", "")
    secret_key = os.environ.get("QINIU_SECRET_KEY", "")
    bucket_name = os.environ.get("QINIU_BUCKET", "")
    key_prefix = os.environ.get("QINIU_KEY_PREFIX", "menzhen-backup/")

    if not access_key or not secret_key or not bucket_name:
        print("Error: QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET must be set", file=sys.stderr)
        sys.exit(1)

    # Object key: prefix + filename
    filename = os.path.basename(local_file)
    key = f"{key_prefix}{filename}"

    # Auth and upload
    q = Auth(access_key, secret_key)
    token = q.upload_token(bucket_name, key, 3600)

    print(f"Uploading {local_file} -> {bucket_name}/{key} ...")
    ret, info = put_file_v2(token, key, local_file, version='v2')

    if info.status_code == 200:
        print(f"Upload success: {key} (hash: {ret.get('hash', 'N/A')})")
    else:
        print(f"Upload failed: status={info.status_code}, body={info.text_body}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
