import { defineScreens } from '../../../design-system/screens.ts'
import { clickByName, waitFor } from '../../../design-system/drive.ts'

const ROAMING = 'C:/Users/You/AppData/Roaming'
const DOCS = 'C:/Users/You/Documents'
const DS6 = 'C:/Program Files/DAZ 3D/DAZStudio6'
const DS4 = 'C:/Program Files/DAZ 3D/DAZStudio4'
const H22 = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const H20 = 'C:/Program Files/Side Effects Software/Houdini 20.5.864'
const LIBRARY = 'D:/DAZ 3D/My DAZ 3D Library'
const MANIFESTS = 'D:/DAZ 3D/Install Manager/ManifestFiles'

export default defineScreens('Settings', [
  {
    id: 'settings-installations',
    title: 'Settings: Daz and Houdini installations',
    route: '/settings',
    // A machine with DIM, two Daz Studios and two Houdinis, seeded as the files the app really reads.
    tune: (seed) => {
      const daz = `${ROAMING}/DAZ 3D`
      seed.roamingDir = ROAMING
      seed.documentDir = DOCS
      seed.houdiniInstalls = [
        { version: '20.5.0.864', path: H20 },
        { version: '22.0.0.368', path: H22 },
      ]
      seed.files[`${H22}/bin/hython.exe`] = 'hython22'
      seed.files[`${H20}/bin/hython.exe`] = 'hython20'
      seed.files[`${DOCS}/houdini22.0/houdini.env`] = 'env22'
      seed.files[`${DOCS}/houdini20.5/houdini.env`] = 'env20'
      seed.files[`${daz}/dzInstall.ini`] =
        `[General]\nInstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64\n\n` +
        `[ApplicationPath]\ndzStudio6InstallDir-64=${DS6}\ndzStudio4InstallDir-64=${DS4}\n`
      seed.files[`${daz}/InstallManager/Settings/AppSettings.ini`] = '[General]\nCurrentUser=Account\n'
      seed.files[`${daz}/InstallManager/UserAccounts/Account.ini`] =
        `[General]\nCurInstallPath=${LIBRARY}\nOverrideManifestDir=${MANIFESTS}\n` +
        'DownloadPath=D:/DAZ 3D/Install Manager/Downloads\n'
      seed.files[`${DS6}/DAZStudio.exe`] = 'ds6'
      seed.files[`${DS4}/DAZStudio.exe`] = 'ds4'
      seed.files[`${LIBRARY}/readme.txt`] = 'library'
      seed.files[`${MANIFESTS}/IM00012345_1_Product.dsx`] = '<dsx/>'
    },
    drive: async (root) => {
      await clickByName(root, /DAZ Studio 6/)
      await waitFor(() => document.body.textContent?.includes('Daz Studio install folder'))
      await clickByName(root, /Houdini 22\.0\.368/)
      await waitFor(() => document.body.textContent?.includes('Houdini documents'))
    },
  },
])
