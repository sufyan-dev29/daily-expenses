import os, re, shutil, sys
A='android'; O='android-overlay'
pkg=f'{A}/app/src/main/java/com/dailyexpenses/app'
os.makedirs(pkg,exist_ok=True)
for f in ('BiometricVaultPlugin.java','MainActivity.java'): shutil.copy(f'{O}/{f}',f'{pkg}/{f}')
shutil.copy(f'{O}/AndroidManifest.xml',f'{A}/app/src/main/AndroidManifest.xml')
xml=f'{A}/app/src/main/res/xml'; os.makedirs(xml,exist_ok=True)
for f in ('data_extraction_rules.xml','network_security_config.xml'): shutil.copy(f'{O}/{f}',f'{xml}/{f}')
shutil.copy(f'{O}/proguard-rules.pro',f'{A}/app/proguard-rules.pro')
g=f'{A}/app/build.gradle'; s=open(g).read()
ver=os.environ.get('VERSION_NAME','1.0.0'); code=os.environ.get('VERSION_CODE','1')
s=re.sub(r'versionCode \d+',f'versionCode {code}',s); s=re.sub(r'versionName "[^"]*"',f'versionName "{ver}"',s)
if 'androidx.biometric' not in s:
    s=s.replace('dependencies {','dependencies {\n    implementation "androidx.biometric:biometric:1.1.0"\n    implementation "androidx.fragment:fragment:1.6.2"',1)
s=re.sub(r'minifyEnabled false','minifyEnabled true\n            shrinkResources true',s)
if 'signingConfigs' not in s and os.environ.get('RELEASE_SIGNING')=='1':
    s=s.replace('buildTypes {','''signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {''',1)
    s=s.replace('release {','release {\n            signingConfig signingConfigs.release',1) if 'signingConfig signingConfigs.release' not in s else s
open(g,'w').write(s)
print(s)
