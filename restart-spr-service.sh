#!/bin/bash
set -e
sudo systemctl restart spr-simulator
sudo systemctl status spr-simulator --no-pager
