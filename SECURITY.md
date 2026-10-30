# Security Policy

## Supported versions

Security fixes are made for the latest minor release only.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting (Security tab, "Report a vulnerability"). Include a sample file if one is needed to reproduce, with any sensitive content removed.

We aim to acknowledge reports within a week.

## Scope

xl-viewer parses untrusted files in the browser. Relevant issues include, for example: script injection through file content, decompression bombs or inputs that exhaust memory despite the documented limits (`maxFileSize`, `maxUncompressedSize`, `maxCells`), and anything that makes the viewer load external resources from a file.
