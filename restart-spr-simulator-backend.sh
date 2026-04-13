#!/bin/bash
# Run this command after a change in the python backend
set -e
sudo systemctl restart spr-simulator
sudo systemctl status spr-simulator --no-pager
