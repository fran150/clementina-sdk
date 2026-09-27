#!/usr/bin/env node
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createClementinaMcpServer} from '../dist/index.js';

void serveStdio(createClementinaMcpServer);
