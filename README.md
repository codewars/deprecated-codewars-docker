========
Codewars Docker
========

This project utilizes Docker to be able to execute sandboxed untrusted code from multiple languages. 

## Overview

A resource pool of Docker containers is maintained to ensure better control over resource constraints. It was found that using a container per unique request did not perform as well. 


## TODO

- [ ] Vagrant File
- [ ] Set CPU/Memory Limits
- [ ] Enable file-access
- [ ] Merge images into one, so that one pool is used
- [ ] Integrate codewars-cli
- [ ] Add maintanence scripts to image to handle resource cleanup
