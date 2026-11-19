import subprocess,xml.etree.ElementTree as E,time,re
def adb(*args):
 return subprocess.check_output(['adb',*args]).decode()
for i in range(10):
 time.sleep(1)
 adb('shell','uiautomator','dump','/sdcard/pair.xml')
 tree=E.fromstring(adb('shell','cat','/sdcard/pair.xml'))
 for e in tree.iter('node'):
  if e.get('text') in ['Ghép nối với máy tính này','Pair with this computer']:
   x,y,u,v=map(int,re.findall(r'\d+',e.get('bounds')))
   adb('shell','input','tap',str((x+u)//2),str((y+v)//2));quit()
print([n.get('text') for n in tree.iter('node') if n.get('text')])
raise SystemExit('No confirmation button')
