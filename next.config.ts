import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {}

export default nextConfig

// Initialise l'environnement Cloudflare pour le dev local (`next dev`)
initOpenNextCloudflareForDev()
